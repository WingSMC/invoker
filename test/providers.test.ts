import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { Invoker, argument, geminiAdapter, claudeAdapter, openAIAdapter } from "../src/index.js";
import type { StreamAdapter, ToolResult, ToolFailure } from "../src/index.js";
import { MockAIService } from "../testing/mock-ai.js";

async function collect<Entry>(stream: AsyncIterable<Entry>) {
  const output: Entry[] = [];
  for await (const entry of stream) output.push(entry);
  return output;
}
async function* source(entries: readonly unknown[]) {
  yield* entries;
}
function setup(adapter: StreamAdapter, consume = false) {
  const invoker = new Invoker({ adapter });
  const handler = vi.fn((value: number) => value * 2);
  invoker.register({
    name: "double",
    description: "Double.",
    sideEffects: "None.",
    args: [argument("value", z.number(), "Number.")],
    returns: { schema: z.number(), description: "Doubled number." },
    handler,
    consume,
  });
  const results: ToolResult[] = [],
    failures: ToolFailure[] = [];
  invoker.onToolCallSuccess((value) => {
    results.push(value);
  });
  invoker.onToolCallFail((value) => {
    failures.push(value);
  });
  return { invoker, handler, results, failures };
}

describe("provider adapters", () => {
  it.each(["gemini", "claude"] as const)(
    "executes parallel %s calls and formats success/failure results",
    async (protocol) => {
      const adapter = protocol === "gemini" ? geminiAdapter() : claudeAdapter();
      const { invoker, handler, results, failures } = setup(adapter);
      const entries = await collect(
        new MockAIService({ fragmentSize: 1 }).stream({
          protocol,
          text: "hello",
          calls: [
            { name: "double", arguments: { value: 3 } },
            { name: "double", arguments: { value: "wrong" } },
            { name: "double", arguments: { value: 4 } },
          ],
        }),
      );
      const output = await collect(invoker.middleware(source(entries)));
      expect(output).toEqual(entries);
      output.forEach((entry, index) => expect(entry).toBe(entries[index]));
      expect(handler.mock.calls).toEqual([[3], [4]]);
      expect(results.map((result) => result.value)).toEqual([6, 8]);
      expect(failures[0]!.error.code).toBe("INVALID_ARGUMENTS");
      if (protocol === "gemini") {
        expect(geminiAdapter().result(results[0]!)).toMatchObject({
          functionResponse: { response: { success: true, result: 6 } },
        });
        expect(invoker.toTools(geminiAdapter())[0]!.functionDeclarations[0]).toHaveProperty(
          "responseJsonSchema",
        );
      } else
        expect(claudeAdapter().result(failures[0]!)).toMatchObject({
          type: "tool_result",
          is_error: true,
        });
    },
  );

  it.each(["gemini", "claude"] as const)(
    "contains truncated %s streams and enforces limits",
    async (protocol) => {
      const adapter = protocol === "gemini" ? geminiAdapter : claudeAdapter;
      const { invoker, handler, failures } = setup(adapter());
      await collect(
        invoker.middleware(
          new MockAIService().stream({
            protocol,
            calls: [{ name: "double", arguments: { value: 4 } }],
            truncate: true,
          }),
        ),
      );
      expect(failures[0]!.error.code).toBe("INCOMPLETE_CALL");
      expect(handler).not.toHaveBeenCalled();
      const limited = setup(adapter({ maxArgumentLength: 1 }));
      await collect(
        limited.invoker.middleware(
          new MockAIService().stream({
            protocol,
            calls: [{ name: "double", arguments: { value: 4 } }],
          }),
        ),
      );
      expect(limited.failures[0]!.error.code).toBe("ARGUMENT_LIMIT");
      const crowded = setup(adapter({ maxPendingCalls: 1 }));
      await collect(
        crowded.invoker.middleware(
          new MockAIService().stream({
            protocol,
            calls: [
              { name: "double", arguments: { value: 1 } },
              { name: "double", arguments: { value: 2 } },
            ],
          }),
        ),
      );
      expect(crowded.failures[0]!.error.code).toBe("CALL_LIMIT");
    },
  );

  it("consumes Gemini function parts while preserving text, unknown calls, signatures, and usage", async () => {
    const { invoker, handler, results } = setup(geminiAdapter(), true);
    const signature = { text: "reason", thoughtSignature: "signed" };
    const unknown = { functionCall: { name: "external", args: {} } };
    const entry = {
      candidates: [
        {
          index: 0,
          content: {
            role: "model",
            parts: [signature, { functionCall: { name: "double", args: { value: 4 } } }, unknown],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { totalTokenCount: 7 },
    };
    const output = await collect(invoker.middleware(source([entry])));
    expect(output[0]).toMatchObject({
      candidates: [{ content: { parts: [signature, unknown] } }],
      usageMetadata: entry.usageMetadata,
    });
    expect(entry.candidates[0]!.content.parts).toHaveLength(3);
    expect(handler).toHaveBeenCalledExactlyOnceWith(4);
    expect(geminiAdapter().result(results[0]!).functionResponse).not.toHaveProperty("id");
  });

  it.each(["gemini", "claude"] as const)(
    "skips calls crossing pause/unregistration in %s",
    async (protocol) => {
      const adapter = protocol === "gemini" ? geminiAdapter() : claudeAdapter();
      const { invoker, handler } = setup(adapter, true);
      const entries = await collect(
        new MockAIService().stream({
          protocol,
          calls: [{ name: "double", arguments: { value: 4 } }],
        }),
      );
      const toolStart = entries.findIndex((entry) =>
        protocol === "gemini"
          ? "candidates" in entry &&
            entry.candidates.some((candidate) =>
              candidate.content.parts.some((part) => "functionCall" in part),
            )
          : "content_block" in entry && entry.content_block?.type === "tool_use",
      );
      async function* paused() {
        for (const [index, entry] of entries.entries()) {
          if (index === toolStart) invoker.pause();
          yield entry;
          if (index === toolStart) invoker.resume();
        }
      }
      await collect(invoker.middleware(paused()));
      expect(handler).not.toHaveBeenCalled();
      invoker.unregister("double");
      expect(await collect(invoker.middleware(source(entries)))).toEqual(entries);
    },
  );

  it("preserves Claude thinking/server blocks and consumes only registered client tool events", async () => {
    const { invoker } = setup(claudeAdapter(), true);
    const entries = await collect(
      new MockAIService().stream({
        protocol: "claude",
        calls: [
          { name: "double", arguments: { value: 2 } },
          { name: "external", arguments: {} },
        ],
      }),
    );
    const thinking = {
      type: "content_block_delta",
      index: 8,
      delta: { type: "signature_delta", signature: "signed" },
    };
    const output = await collect(invoker.middleware(source([thinking, ...entries])));
    expect(output).toContain(thinking);
    expect(output).toContainEqual(expect.objectContaining({ type: "message_stop" }));
    expect(output).toContainEqual(
      expect.objectContaining({ content_block: expect.objectContaining({ name: "external" }) }),
    );
    expect(
      output.some(
        (entry) =>
          (entry as { content_block?: { name?: string } }).content_block?.name === "double",
      ),
    ).toBe(false);
  });

  it("rejects partial Vertex arguments and non-STOP Gemini completions without executing", async () => {
    const { invoker, handler, failures } = setup(geminiAdapter());
    await collect(
      invoker.middleware(
        source([
          {
            candidates: [
              {
                index: 0,
                content: {
                  parts: [
                    { functionCall: { name: "double", args: { value: 1 }, willContinue: true } },
                  ],
                },
                finishReason: "STOP",
              },
            ],
          },
        ]),
      ),
    );
    expect(failures[0]!.error.code).toBe("INCOMPLETE_CALL");
    await collect(
      invoker.middleware(
        source([
          {
            candidates: [
              {
                index: 0,
                content: { parts: [{ functionCall: { name: "double", args: { value: 1 } } }] },
                finishReason: "MAX_TOKENS",
              },
            ],
          },
        ]),
      ),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps OpenAI format selection in its adapter and excludes internal result schemas", () => {
    const { invoker } = setup(openAIAdapter());
    expect(invoker.toTools()[0]!.function).not.toHaveProperty("resultSchema");
    expect(invoker.toTools(openAIAdapter({ protocol: "responses" }))[0]).toMatchObject({
      type: "function",
      name: "double",
    });
    const outcome: ToolResult = {
      call: { id: "c", name: "double", arguments: {} },
      args: {},
      value: 4,
      content: '{"success":true,"result":4}',
    };
    expect(openAIAdapter().result(outcome)).toEqual({
      role: "tool",
      tool_call_id: "c",
      content: outcome.content,
    });
    expect(openAIAdapter({ protocol: "responses" }).result(outcome)).toEqual({
      type: "function_call_output",
      call_id: "c",
      output: outcome.content,
    });
  });

  it("does not reset Gemini partial-call errors when the same ID appears again", async () => {
    const { invoker, handler, failures } = setup(geminiAdapter());
    const partial = { id: "same", name: "double", args: { value: 1 }, willContinue: true };
    const complete = { id: "same", name: "double", args: { value: 1 } };
    await collect(
      invoker.middleware(
        source([
          { candidates: [{ index: 0, content: { parts: [{ functionCall: partial }] } }] },
          {
            candidates: [
              { index: 0, content: { parts: [{ functionCall: complete }] }, finishReason: "STOP" },
            ],
          },
        ]),
      ),
    );
    expect(handler).not.toHaveBeenCalled();
    expect(failures).toHaveLength(1);
    expect(failures[0]!.error.code).toBe("INCOMPLETE_CALL");
  });
});

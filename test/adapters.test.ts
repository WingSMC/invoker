import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { Invoker, ToolError, argument, openAIAdapter } from "../src/index.js";

async function* source(entries: readonly unknown[]) {
  yield* entries;
}
async function collect(stream: AsyncIterable<unknown>) {
  const entries: unknown[] = [];
  for await (const entry of stream) entries.push(entry);
  return entries;
}

describe("adapter boundaries", () => {
  it("preserves arbitrary passthrough values including undefined", async () => {
    const invoker = new Invoker();
    const entries = [undefined, null, false, 1, "data", { custom: true }];
    expect(await collect(invoker.middleware(source(entries)))).toEqual(entries);
  });

  it("accepts a custom adapter while retaining validation and lifecycle dispatch", async () => {
    const invoker = new Invoker();
    invoker.register({
      name: "echo",
      description: "Echo",
      args: [argument("text", z.string(), "Text")],
      handler: (text) => text,
    });
    const success = vi.fn();
    invoker.onToolCallSuccess(success);
    await collect(
      invoker.middleware(source(["hello"]), {
        adapter: {
          create: () => ({
            push: (entry) => ({
              entry,
              calls: [{ id: "c", name: "echo", arguments: { text: entry } }],
            }),
            finish: () => [],
          }),
        },
      }),
    );
    expect(success.mock.calls[0]?.[0].value).toBe("hello");
  });

  it("reports adapter creation errors through onStreamError", async () => {
    const invoker = new Invoker();
    const onError = vi.fn();
    invoker.on("onStreamError", onError);
    const error = new Error("adapter setup");
    await expect(
      collect(
        invoker.middleware(source([]), {
          adapter: {
            create: () => {
              throw error;
            },
          },
        }),
      ),
    ).rejects.toBe(error);
    expect(onError).toHaveBeenCalledExactlyOnceWith({ error });
  });

  it("validates buffering limits", () => {
    for (const maxArgumentLength of [0, -1, 1.5, Infinity]) {
      expect(() => openAIAdapter({ maxArgumentLength })).toThrow(RangeError);
    }
    expect(() => new Invoker({ maxPendingCalls: 0 })).toThrow(RangeError);
  });

  it("preserves metadata on chunks containing only consumed tool fragments", () => {
    const session = openAIAdapter().create();
    const entry = {
      id: "chat",
      custom_metadata: { trace: true },
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, id: "c", function: { name: "echo", arguments: "{}" } }],
          },
          finish_reason: null,
        },
      ],
    };
    const adapted = session.push(entry, true, () => true);
    expect(adapted.consumed).toBe(false);
    expect(adapted.entry).toMatchObject({ custom_metadata: { trace: true } });
  });

  it("reports incomplete Responses and accepts complete standalone done entries", async () => {
    const invoker = new Invoker();
    invoker.register({ name: "echo", description: "Echo", args: [], handler: () => "ok" });
    const fail = vi.fn();
    const success = vi.fn();
    invoker.onToolCallFail(fail);
    invoker.onToolCallSuccess(success);
    const item = { id: "i", call_id: "c", type: "function_call", name: "echo", arguments: "{}" };
    await collect(
      invoker.middleware(
        source([{ type: "response.output_item.added", item }, { type: "response.incomplete" }]),
      ),
    );
    expect(fail.mock.calls[0]?.[0].error).toBeInstanceOf(ToolError);
    expect(fail.mock.calls[0]?.[0].error.code).toBe("INCOMPLETE_CALL");
    await collect(
      invoker.middleware(
        source([{ type: "response.output_item.done", item: { ...item, status: "completed" } }]),
      ),
    );
    expect(success).toHaveBeenCalledOnce();
  });
});

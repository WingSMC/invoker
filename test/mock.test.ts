import { describe, expect, it, vi } from "vite-plus/test";
import { Invoker, argument } from "../src/index.js";
import { z } from "zod";
import { MockAIService } from "../testing/mock-ai.js";
import type { MockEvent } from "../testing/mock-ai.js";

async function collect<Entry>(source: AsyncIterable<Entry>): Promise<Entry[]> {
  const entries: Entry[] = [];
  for await (const entry of source) entries.push(entry);
  return entries;
}

function registry() {
  const invoker = new Invoker();
  const handler = vi.fn((value: number) => value * 2);
  invoker.register({
    name: "double",
    description: "Double a number",
    args: [argument("value", z.number(), "Number")],
    handler,
  });
  const failed = vi.fn();
  invoker.onToolCallFail(failed);
  return { invoker, handler, failed };
}

describe("internal mock AI service", () => {
  it.each(["chat-completions", "responses"] as const)(
    "drives real invocation from %s fragmented calls",
    async (protocol) => {
      const mock = new MockAIService({ fragmentSize: 1 });
      const { invoker, handler } = registry();
      const output = await collect(
        invoker.middleware(
          mock.stream({
            protocol,
            text: "Checking…",
            calls: [{ name: "double", arguments: { value: 4 } }],
          }),
        ),
      );
      expect(output.length).toBeGreaterThan(15);
      expect(handler).toHaveBeenCalledExactlyOnceWith(4);
      if (protocol === "chat-completions")
        expect(output.at(-1)).toMatchObject({ choices: [], usage: { total_tokens: 72 } });
      else expect(output.at(-1)).toMatchObject({ type: "response.completed" });
    },
  );

  it("interleaves multiple chat calls by index and uses distinct IDs for concurrent requests", async () => {
    const mock = new MockAIService({ fragmentSize: 2 });
    const { invoker, handler } = registry();
    const first = collect(
      invoker.middleware(
        mock.stream({
          calls: [
            { name: "double", arguments: { value: 3 } },
            { name: "double", arguments: { value: 5 } },
          ],
        }),
      ),
    );
    const second = collect(
      invoker.middleware(mock.stream({ calls: [{ name: "double", arguments: { value: 7 } }] })),
    );
    const [one, two] = await Promise.all([first, second]);
    expect(handler.mock.calls.map(([value]) => value).sort((a, b) => a - b)).toEqual([3, 5, 7]);
    expect(one[0]?.id).not.toBe(two[0]?.id);
    expect(one.some((chunk) => chunk.choices[0]?.delta.tool_calls?.length === 2)).toBe(true);
  });

  it("replays a script deterministically with fresh service instances", async () => {
    const request = { text: "hello", calls: [{ name: "double", arguments: { value: 4 } }] };
    expect(await collect(new MockAIService().stream(request))).toEqual(
      await collect(new MockAIService().stream(request)),
    );
  });

  it.each(["chat-completions", "responses"] as const)(
    "produces validation failures and truncated calls in %s",
    async (protocol) => {
      const { invoker, handler, failed } = registry();
      const mock = new MockAIService();
      for (const [input, expected] of [
        ["{broken", "INVALID_JSON"],
        ['{"value":"bad"}', "INVALID_ARGUMENTS"],
      ] as const) {
        await collect(
          invoker.middleware(
            mock.stream({ protocol, calls: [{ name: "double", arguments: input }] }),
          ),
        );
        expect(failed.mock.lastCall?.[0].error.code).toBe(expected);
      }
      await collect(
        invoker.middleware(
          mock.stream({
            protocol,
            calls: [{ name: "double", arguments: { value: 4 } }],
            truncate: true,
          }),
        ),
      );
      expect(failed.mock.lastCall?.[0].error.code).toBe("INCOMPLETE_CALL");
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it("simulates network failures at the requested boundary", async () => {
    const mock = new MockAIService();
    const events: MockEvent[] = [];
    await expect(
      (async () => {
        for await (const event of mock.stream({ text: "hello", failAfter: 1 })) events.push(event);
      })(),
    ).rejects.toThrow("after 1 entries");
    expect(events).toHaveLength(1);
  });

  it("aborts during a pending delay and removes its timer", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const mock = new MockAIService({ delayMs: 500 });
      const stream = mock.stream({ signal: controller.signal });
      const next = stream.next();
      const rejected = expect(next).rejects.toMatchObject({ name: "AbortError" });
      controller.abort();
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects invalid settings", async () => {
    expect(() => new MockAIService({ fragmentSize: 0 })).toThrow(RangeError);
    expect(() => new MockAIService({ delayMs: -1 })).toThrow(RangeError);
    await expect(collect(new MockAIService().stream({ failAfter: -1 }))).rejects.toThrow(
      RangeError,
    );
  });
});

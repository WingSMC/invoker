import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { Invoker, argument } from "../src/index.js";
import type { ToolFailure, ToolResult } from "../src/index.js";

function chunk(toolCalls: unknown[] = [], finish: string | null = null, extra = {}) {
  return {
    id: "chat_1",
    object: "chat.completion.chunk",
    choices: [
      { index: 0, delta: toolCalls.length ? { tool_calls: toolCalls } : {}, finish_reason: finish },
    ],
    ...extra,
  };
}
function fragment(name?: string, args = "", index = 0) {
  return {
    index,
    ...(name
      ? { id: `call_${index}`, type: "function", function: { name, arguments: args } }
      : { function: { arguments: args } }),
  };
}
async function* source(entries: readonly unknown[]) {
  yield* entries;
}
async function collect<Entry>(stream: AsyncIterable<Entry>): Promise<Entry[]> {
  const values: Entry[] = [];
  for await (const value of stream) values.push(value);
  return values;
}
function setup(consume = false) {
  const invoker = new Invoker();
  const handler = vi.fn((value: number) => value * 2);
  invoker.register({
    name: "double",
    description: "Double a number",
    sideEffects: "None.",
    returns: { schema: z.number(), description: "The double function result." },
    args: [argument("value", z.number(), "Number")],
    consume,
    handler,
  });
  const results: ToolResult[] = [];
  const failures: ToolFailure[] = [];
  invoker.onToolCallSuccess((event) => {
    results.push(event);
  });
  invoker.onToolCallFail((event) => {
    failures.push(event);
  });
  return { invoker, handler, results, failures };
}

describe("stream middleware", () => {
  it("aggregates fragmented arguments only at completion and preserves all original objects by default", async () => {
    const { invoker, handler, results } = setup();
    const entries = [
      chunk([fragment("double", '{"val')]),
      { type: "custom", data: 1 },
      chunk([fragment(undefined, 'ue":4}')]),
      chunk([], "tool_calls"),
      { id: "chat_1", choices: [], usage: { total_tokens: 42 } },
    ];
    const stream = invoker.middleware(source(entries));
    expect((await stream.next()).value).toBe(entries[0]);
    expect(handler).not.toHaveBeenCalled();
    const output = [entries[0], ...(await collect(stream))];
    expect(output).toEqual(entries);
    output.forEach((entry, index) => expect(entry).toBe(entries[index]));
    expect(handler).toHaveBeenCalledExactlyOnceWith(4);
    expect(results[0]?.content).toBe('{"success":true,"result":8}');
  });

  it("preserves unknown tools without running them or emitting failures", async () => {
    const { invoker, handler, failures } = setup(true);
    const entries = [chunk([fragment("external", "{}")]), chunk([], "tool_calls")];
    expect(await collect(invoker.middleware(source(entries)))).toEqual(entries);
    expect(handler).not.toHaveBeenCalled();
    expect(failures).toEqual([]);
  });

  it("consumes only configured fragments and preserves mixed text, unknown tools, and usage", async () => {
    const { invoker, handler } = setup(true);
    const mixed = chunk([fragment("double", '{"value":4}'), fragment("external", "{}", 1)]);
    Object.assign(mixed.choices[0]!.delta, { content: "visible text" });
    const continuation = chunk([fragment(undefined, " ")]);
    const usage = { id: "chat_1", choices: [], usage: { total_tokens: 12 } };
    const output = await collect(
      invoker.middleware(source([mixed, continuation, chunk([], "tool_calls"), usage])),
    );
    expect(output).toHaveLength(3);
    expect(output[0]).toMatchObject({
      choices: [
        { delta: { content: "visible text", tool_calls: [fragment("external", "{}", 1)] } },
      ],
    });
    expect(mixed.choices[0]!.delta.tool_calls).toHaveLength(2);
    expect(output[2]).toBe(usage);
    expect(handler).toHaveBeenCalledExactlyOnceWith(4);
  });

  it("passes everything through while paused and never executes a partially paused call", async () => {
    const { invoker, handler } = setup(true);
    invoker.pause();
    const entries = [chunk([fragment("double", '{"value":4}')]), chunk([], "tool_calls")];
    expect(await collect(invoker.middleware(source(entries)))).toEqual(entries);
    invoker.resume();
    async function* pausedSource() {
      yield chunk([fragment("double", '{"value":')]);
      invoker.pause();
      yield chunk([fragment(undefined, "4}")]);
      invoker.resume();
      yield chunk([], "tool_calls");
    }
    await collect(invoker.middleware(pausedSource()));
    expect(handler).not.toHaveBeenCalled();
    await collect(invoker.middleware(source(entries)));
    expect(handler).toHaveBeenCalledOnce();
  });

  it("unregisters before completion and stops consuming subsequent fragments", async () => {
    const { invoker, handler } = setup(true);
    const continuation = chunk([fragment(undefined, "4}")]);
    async function* unregistering() {
      yield chunk([fragment("double", '{"value":')]);
      invoker.unregister("double");
      yield continuation;
      yield chunk([], "tool_calls");
    }
    const output = await collect(invoker.middleware(unregistering()));
    expect(output[0]).toBe(continuation);
    expect(handler).not.toHaveBeenCalled();
  });

  it("separates parallel calls, choices, and concurrent streams", async () => {
    const { invoker, results } = setup();
    const parallel = [
      chunk([fragment("double", '{"value":1}', 0), fragment("double", '{"value":2}', 1)]),
      {
        id: "chat_1",
        choices: [
          {
            index: 1,
            delta: { tool_calls: [fragment("double", '{"value":3}')] },
            finish_reason: null,
          },
        ],
      },
      {
        id: "chat_1",
        choices: [
          { index: 0, delta: {}, finish_reason: "tool_calls" },
          { index: 1, delta: {}, finish_reason: "tool_calls" },
        ],
      },
    ];
    await Promise.all([
      collect(invoker.middleware(source(parallel))),
      collect(invoker.middleware(source(parallel))),
    ]);
    expect(
      results.map((result) => result.value).sort((left, right) => Number(left) - Number(right)),
    ).toEqual([2, 2, 4, 4, 6, 6]);
  });

  it("reports truncated streams and argument limits without executing incomplete input", async () => {
    const { invoker, handler, failures } = setup();
    await collect(invoker.middleware(source([chunk([fragment("double", '{"value":4}')])])));
    expect(handler).not.toHaveBeenCalled();
    expect(failures[0]?.error.code).toBe("INCOMPLETE_CALL");
    const limited = new Invoker({ maxArgumentLength: 4 });
    limited.register({
      name: "double",
      description: "D",
      sideEffects: "None.",
      returns: { schema: z.number(), description: "The double function result." },
      args: [argument("value", z.number(), "Number")],
      handler,
    });
    const fail = vi.fn();
    limited.onToolCallFail(fail);
    await collect(
      limited.middleware(source([chunk([fragment("double", "12345")]), chunk([], "tool_calls")])),
    );
    expect(fail.mock.calls[0]?.[0].error.code).toBe("ARGUMENT_LIMIT");
    expect(handler).not.toHaveBeenCalled();
  });

  it("treats length/content-filter finishes as incomplete and bounds pending calls", async () => {
    const { invoker, failures, handler } = setup();
    await collect(
      invoker.middleware(source([chunk([fragment("double", '{"value":4}')]), chunk([], "length")])),
    );
    expect(failures[0]?.error.code).toBe("INCOMPLETE_CALL");
    const limited = new Invoker({ maxPendingCalls: 1 });
    limited.register({
      name: "double",
      description: "D",
      sideEffects: "None.",
      returns: { schema: z.number(), description: "The double function result." },
      args: [argument("value", z.number(), "Number")],
      handler,
    });
    const fail = vi.fn();
    limited.onToolCallFail(fail);
    await collect(
      limited.middleware(
        source([
          chunk([fragment("double", "{}"), fragment("double", "{}", 1)]),
          chunk([], "tool_calls"),
        ]),
      ),
    );
    expect(fail.mock.calls[0]?.[0].error.code).toBe("CALL_LIMIT");
    expect(handler).not.toHaveBeenCalled();
  });

  it("contains tool failures and continues with later chat entries", async () => {
    const { invoker, failures } = setup();
    const final = { content: "later" };
    const entries = [
      chunk([fragment("double", '{"value":"bad"}')]),
      chunk([], "tool_calls"),
      final,
    ];
    expect(await collect(invoker.middleware(source(entries)))).toEqual(entries);
    expect(failures[0]?.error.code).toBe("INVALID_ARGUMENTS");
  });

  it("propagates source errors, reports them, and closes on consumer cancellation", async () => {
    const { invoker, failures } = setup();
    const error = new Error("network failed");
    const onError = vi.fn();
    invoker.on("onStreamError", onError);
    async function* broken() {
      yield chunk([fragment("double", "{}")]);
      throw error;
    }
    await expect(collect(invoker.middleware(broken()))).rejects.toBe(error);
    expect(onError).toHaveBeenCalledExactlyOnceWith({ error });
    expect(failures[0]?.error.code).toBe("INCOMPLETE_CALL");
    const close = vi.fn();
    async function* closeable() {
      try {
        yield { text: 1 };
        yield { text: 2 };
      } finally {
        close();
      }
    }
    for await (const _entry of invoker.middleware(closeable())) break;
    expect(close).toHaveBeenCalledOnce();
  });

  it("interrupts Effect handlers through the middleware AbortSignal", async () => {
    const invoker = new Invoker();
    const controller = new AbortController();
    const finalizer = vi.fn();
    invoker.register({
      name: "wait",
      description: "Wait",
      sideEffects: "None.",
      args: [],
      handler: () => Effect.never.pipe(Effect.ensuring(Effect.sync(finalizer))),
    });
    invoker.onBeforeToolCall(() => {
      queueMicrotask(() => controller.abort());
    });
    const failures = vi.fn();
    invoker.onToolCallFail(failures);
    await collect(
      invoker.middleware(source([chunk([fragment("wait", "{}")]), chunk([], "tool_calls")]), {
        signal: controller.signal,
      }),
    );
    expect(finalizer).toHaveBeenCalledOnce();
    expect(failures.mock.calls[0]?.[0].error.code).toBe("CANCELLED");
  });

  it.each([false, true])("handles Responses calls once with consume=%s", async (consume) => {
    const { invoker, handler, results } = setup(consume);
    const item = {
      id: "fc_1",
      call_id: "call_r",
      type: "function_call",
      name: "double",
      arguments: "",
      status: "in_progress",
    };
    const text = { type: "response.output_text.delta", delta: "hello" };
    const events = [
      { type: "response.output_item.added", output_index: 0, item },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"value":' },
      text,
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: "4}" },
      { type: "response.function_call_arguments.done", item_id: "fc_1", arguments: '{"value":4}' },
      {
        type: "response.output_item.done",
        item: { ...item, arguments: '{"value":4}', status: "completed" },
      },
      {
        type: "response.completed",
        response: { output: [{ ...item, arguments: '{"value":4}', status: "completed" }] },
      },
    ];
    const output = await collect(invoker.middleware(source(events)));
    expect(output).toEqual(consume ? [text, events[6]] : events);
    expect(handler).toHaveBeenCalledExactlyOnceWith(4);
    expect(results[0]?.call.id).toBe("call_r");
    expect(results[0]?.call.protocol).toBe("responses");
  });
});

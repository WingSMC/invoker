import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { Invoker, ToolError, argument } from "../src/index.js";
import type { ToolCall, ToolErrorCode, ToolFailure } from "../src/index.js";

const call: ToolCall = { id: "call_1", name: "add", arguments: '{"left":2,"right":3}' };

function setup(handler = (left: number, right: number) => left + right) {
  const invoker = new Invoker();
  const unregister = invoker.register({
    name: "add",
    description: "Add two numbers",
    sideEffects: "None.",
    returns: { schema: z.number(), description: "The add function result." },
    args: [
      argument("left", z.number(), "Left operand"),
      argument("right", z.number(), "Right operand"),
    ],
    handler,
  });
  return { invoker, unregister };
}

async function failure(invoker: Invoker, input: ToolCall): Promise<ToolError> {
  const exit = await Effect.runPromiseExit(invoker.invoke(input));
  expect(Exit.isFailure(exit)).toBe(true);
  if (!Exit.isFailure(exit)) throw new Error("Expected failure");
  return Cause.squash(exit.cause) as ToolError;
}

describe("registry and execution", () => {
  it("exports documented JSON schema and maps named input to positional arguments", async () => {
    const handler = vi.fn((left: number, right: number) => left + right);
    const { invoker } = setup(handler);
    const schemas = invoker.toTools();
    expect(schemas[0]?.function.parameters).toMatchObject({
      type: "object",
      properties: { left: { type: "number", description: "Left operand" } },
      required: ["left", "right"],
      additionalProperties: false,
    });
    expect(invoker.toResponseTools()[0]).toMatchObject({
      type: "function",
      name: "add",
      strict: false,
    });
    const result = await Effect.runPromise(
      invoker.invoke({ ...call, arguments: '{"right":3,"left":2}' }),
    );
    expect(handler).toHaveBeenCalledExactlyOnceWith(2, 3);
    expect(result).toMatchObject({
      value: 5,
      content: '{"success":true,"result":5}',
      args: { left: 2, right: 3 },
    });
    schemas[0]!.function.parameters.type = "string";
    expect(invoker.toTools()[0]?.function.parameters.type).toBe("object");
  });

  it("is lazy and emits lifecycle events in order", async () => {
    const { invoker } = setup();
    const order: string[] = [];
    const off = invoker.onBeforeArgValidation(() => {
      order.push("validate");
    });
    invoker.onBeforeToolCall(() => {
      order.push("before");
    });
    invoker.onToolCallSuccess(() => {
      order.push("success");
    });
    invoker.onAfterToolCall(() => {
      order.push("after");
    });
    const effect = invoker.invoke(call);
    expect(order).toEqual([]);
    await Effect.runPromise(effect);
    expect(order).toEqual(["validate", "before", "success", "after"]);
    off();
    order.length = 0;
    await Effect.runPromise(effect);
    expect(order).toEqual(["before", "success", "after"]);
  });

  it.each([
    ["not json", "INVALID_JSON"],
    ['{"left":"2","right":3}', "INVALID_ARGUMENTS"],
    ['{"left":2,"right":3,"extra":true}', "INVALID_ARGUMENTS"],
    ["null", "INVALID_ARGUMENTS"],
  ] as const)("reports %s as %s and never invokes the handler", async (input, code) => {
    const handler = vi.fn((left: number, right: number) => left + right);
    const { invoker } = setup(handler);
    const events: ToolFailure[] = [];
    invoker.onToolCallFail((event) => {
      events.push(event);
    });
    expect((await failure(invoker, { ...call, arguments: input })).code).toBe(code);
    expect(handler).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(JSON.parse(events[0]!.content)).toMatchObject({ error: { code } });
  });

  it("supports optional/defaulted arguments, transforms, and async refinements", async () => {
    const invoker = new Invoker();
    invoker.register({
      name: "transform",
      description: "Transform input",
      sideEffects: "None.",
      returns: {
        schema: z.object({ value: z.number(), label: z.string().optional() }),
        description: "The transform function result.",
      },
      args: [
        argument(
          "value",
          z
            .string()
            .refine(async (value) => value !== "bad")
            .transform((value) => value.length),
          "Value",
        ),
        argument("multiplier", z.number().default(2), "Multiplier"),
        argument("label", z.string().optional(), "Label"),
      ],
      handler: (value, multiplier, label) => ({ value: value * multiplier, label }),
    });
    const input = { id: "t", name: "transform", arguments: '{"value":"hello"}' };
    expect((await Effect.runPromise(invoker.invoke(input))).value).toEqual({
      value: 10,
      label: undefined,
    });
    expect((await failure(invoker, { ...input, arguments: '{"value":"bad"}' })).code).toBe(
      "INVALID_ARGUMENTS",
    );
  });

  const handlerFailures: readonly [() => unknown, ToolErrorCode][] = [
    [
      (): never => {
        throw new Error("sync");
      },
      "HANDLER_FAILED",
    ],
    [() => Promise.reject(new Error("promise")), "HANDLER_FAILED"],
    [(): Effect.Effect<never, string> => Effect.fail("typed failure"), "HANDLER_FAILED"],
    [(): Effect.Effect<never> => Effect.die("defect"), "HANDLER_FAILED"],
    [() => 1n, "SERIALIZATION_FAILED"],
    [
      (): Record<string, unknown> => {
        const result: Record<string, unknown> = {};
        result.self = result;
        return result;
      },
      "SERIALIZATION_FAILED",
    ],
  ];
  it.each(handlerFailures)("contains handler failure %#", async (handler, code) => {
    const invoker = new Invoker();
    invoker.register({
      name: "fail",
      description: "Fails",
      sideEffects: "None.",
      returns: { schema: z.unknown(), description: "The fail function result." },
      args: [],
      handler,
    });
    const after = vi.fn();
    invoker.onAfterToolCall(after);
    const error = await failure(invoker, { id: "f", name: "fail", arguments: "{}" });
    expect(error.code).toBe(code satisfies ToolErrorCode);
    expect(after).toHaveBeenCalledOnce();
  });

  it("supports successful promises, Effects, strings, and undefined", async () => {
    for (const [handler, content] of [
      [() => Promise.resolve(42), '{"success":true,"result":42}'],
      [() => Effect.succeed("hello"), '{"success":true,"result":"hello"}'],
      [() => undefined, '{"success":true}'],
    ] as const) {
      const invoker = new Invoker();
      invoker.register({
        name: "result",
        description: "Return result",
        sideEffects: "None.",
        returns: { schema: z.unknown(), description: "The result function result." },
        args: [],
        handler,
      });
      expect(
        (await Effect.runPromise(invoker.invoke({ id: "r", name: "result", arguments: "{}" })))
          .content,
      ).toBe(content);
    }
  });

  it("isolates throwing/rejecting observers without changing success", async () => {
    const { invoker } = setup();
    const errors = vi.fn();
    invoker.on("onListenerError", errors);
    invoker.onBeforeToolCall(() => {
      throw new Error("UI error");
    });
    invoker.onToolCallSuccess(async () => {
      throw new Error("async UI error");
    });
    invoker.on("onListenerError", () => {
      throw new Error("error reporter error");
    });
    expect((await Effect.runPromise(invoker.invoke(call))).value).toBe(5);
    await Promise.resolve();
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it("unregisters at runtime and stale disposal cannot remove a replacement", async () => {
    const { invoker, unregister } = setup();
    expect(invoker.size).toBe(1);
    expect(invoker.unregister("missing")).toBe(false);
    unregister();
    expect((await failure(invoker, call)).code).toBe("NOT_REGISTERED");
    invoker.register({
      name: "add",
      description: "Replacement",
      sideEffects: "None.",
      returns: { schema: z.number(), description: "The add function result." },
      args: [],
      handler: () => 1,
    });
    unregister();
    expect(invoker.has("add")).toBe(true);
    invoker.pause();
    expect((await failure(invoker, call)).code).toBe("PAUSED");
    invoker.resume();
    expect(invoker.paused).toBe(false);
  });

  it("rejects duplicate names/arguments and missing documentation", () => {
    const { invoker } = setup();
    expect(() =>
      invoker.register({
        name: "add",
        description: "D",
        sideEffects: "None.",
        returns: { schema: z.number(), description: "The add function result." },
        args: [],
        handler: () => 0,
      }),
    ).toThrow("already registered");
    expect(() =>
      invoker.register({
        name: "bad name",
        description: "D",
        sideEffects: "None.",
        returns: { schema: z.number(), description: "The bad name function result." },
        args: [],
        handler: () => 0,
      }),
    ).toThrow("Tool names");
    expect(() =>
      invoker.register({
        name: "empty",
        description: "",
        sideEffects: "None.",
        returns: { schema: z.number(), description: "The empty function result." },
        args: [],
        handler: () => 0,
      }),
    ).toThrow("documentation");
    expect(() =>
      invoker.register({
        name: "duplicate",
        description: "D",
        sideEffects: "None.",
        returns: { schema: z.number(), description: "The duplicate function result." },
        args: [argument("a", z.string(), "A"), argument("a", z.number(), "B")],
        handler: () => 0,
      }),
    ).toThrow("Duplicate argument");
  });
});

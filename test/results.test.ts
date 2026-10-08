import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { Invoker } from "../src/index.js";

describe("documented tool results", () => {
  it("skips result parsing, cloning, refinements, and transforms by default", async () => {
    const invoker = new Invoker();
    const refine = vi.fn(() => false);
    const value = { count: 1 };
    const tool = invoker.register({
      name: "value",
      description: "Value.",
      sideEffects: "None.",
      args: [],
      returns: { schema: z.object({ count: z.number() }).refine(refine), description: "Count." },
      handler: () => value,
    });
    const result = await Effect.runPromise(tool.invoke({ id: "a", arguments: {} }));
    expect(result.value).toBe(value);
    expect(refine).not.toHaveBeenCalled();
    expect(JSON.parse(result.content)).toEqual({ success: true, result: value });
    const transform = vi.fn((input: string) => input.length);
    const trusted = invoker.register({
      name: "trusted_transform",
      description: "Trusted output.",
      sideEffects: "None.",
      args: [],
      returns: { schema: z.string().transform(transform).pipe(z.number()), description: "Length." },
      handler: () => 42,
    });
    expect((await Effect.runPromise(trusted.invoke({ id: "b", arguments: {} }))).value).toBe(42);
    expect(transform).not.toHaveBeenCalled();
  });
  it("exports result schemas, field context, side effects, and response semantics to both APIs", () => {
    const invoker = new Invoker();
    invoker.register({
      name: "create_record",
      description: "Create a record.",
      sideEffects: "Writes one database record.",
      args: [],
      returns: {
        schema: z.object({ id: z.string().describe("Created record identifier.") }),
        description: "The new record ID.",
      },
      handler: () => ({ id: "record-1" }),
    });
    const description = invoker.toTools()[0]!.function.description;
    expect(description).toContain("Side effects: Writes one database record.");
    expect(description).toContain("Result: The new record ID.");
    expect(description).toContain('"description":"Created record identifier."');
    expect(description).toContain("success: true");
    expect(description).toContain("success: false");
    expect(invoker.toResponseTools()[0]!.description).toBe(description);
    expect(invoker.toTools()[0]!.function.parameters).not.toHaveProperty("result");
  });

  it.each(["sync", "promise", "effect"])(
    "acknowledges %s void handlers with a default void contract",
    async (kind) => {
      const invoker = new Invoker();
      const action = vi.fn();
      const tool = invoker.register({
        name: "refresh",
        description: "Refresh the view.",
        sideEffects: "Updates the visible UI.",
        args: [],
        handler: () => {
          if (kind === "effect")
            return Effect.sync(() => {
              action();
            });
          if (kind === "promise")
            return Promise.resolve().then(() => {
              action();
            });
          action();
        },
      });
      const result = await Effect.runPromise(tool.invoke({ id: "c", arguments: {} }));
      expect(result.value).toBeUndefined();
      expect(JSON.parse(result.content)).toEqual({ success: true });
      expect(action).toHaveBeenCalledOnce();
      expect(invoker.toTools()[0]!.function.description).toContain("No value is returned");
    },
  );

  it("rejects unexpected void values and invalid output without emitting success", async () => {
    const invoker = new Invoker();
    const success = vi.fn();
    invoker.onToolCallSuccess(success);
    const badVoid = invoker.register({
      name: "bad_void",
      description: "Void action.",
      sideEffects: "None.",
      args: [],
      handler: (() => 1) as () => void,
      returns: { schema: z.void(), description: "No value.", validate: true },
    });
    await expect(
      Effect.runPromise(badVoid.invoke({ id: "a", arguments: {} })),
    ).rejects.toMatchObject({ code: "INVALID_RESULT" });
    const badNumber = invoker.register({
      name: "bad_number",
      description: "Positive count.",
      sideEffects: "None.",
      args: [],
      returns: { schema: z.number().positive(), description: "A positive count.", validate: true },
      handler: () => -1,
    });
    const failed = vi.fn();
    badNumber.onAfterToolCall(failed);
    await expect(
      Effect.runPromise(badNumber.invoke({ id: "b", arguments: {} })),
    ).rejects.toMatchObject({ code: "INVALID_RESULT" });
    expect(JSON.parse(failed.mock.calls[0]![0].content)).toMatchObject({
      success: false,
      error: { code: "INVALID_RESULT" },
    });
    expect(success).not.toHaveBeenCalled();
  });

  it("validates async return refinements and exposes transformed outputs", async () => {
    const invoker = new Invoker();
    const tool = invoker.register({
      name: "count",
      description: "Count.",
      sideEffects: "None.",
      args: [],
      returns: {
        schema: z
          .string()
          .transform((value) => value.length)
          .pipe(z.number().refine(async (value) => value > 0)),
        description: "Character count.",
        validate: true,
      },
      handler: () => "hello",
    });
    const listener = vi.fn();
    tool.onToolCallSuccess(listener);
    const result = await Effect.runPromise(tool.invoke({ id: "a", arguments: {} }));
    expect(result.value).toBe(5);
    expect(JSON.parse(result.content)).toEqual({ success: true, result: 5 });
    expect(listener.mock.calls[0]![0].value).toBe(5);
    expect(invoker.toTools()[0]!.function.description).toContain('"type":"number"');
  });

  it("ties typed handles to a registration while in-flight calls finish with the original handler", async () => {
    const invoker = new Invoker();
    const original = invoker.register({
      name: "value",
      description: "Original.",
      sideEffects: "None.",
      args: [],
      returns: { schema: z.number(), description: "Number." },
      handler: () => 1,
    });
    const seen = vi.fn();
    original.onToolCallSuccess(seen);
    invoker.onBeforeToolCall(() => {
      original();
      invoker.register({
        name: "value",
        description: "Replacement.",
        sideEffects: "None.",
        args: [],
        returns: { schema: z.string(), description: "String." },
        handler: () => "new",
      });
    });
    expect((await Effect.runPromise(original.invoke({ id: "a", arguments: {} }))).value).toBe(1);
    expect(seen).toHaveBeenCalledOnce();
    await expect(
      Effect.runPromise(original.invoke({ id: "b", arguments: {} })),
    ).rejects.toMatchObject({ code: "NOT_REGISTERED" });
    original();
    expect(invoker.has("value")).toBe(true);
  });

  it("isolates per-tool observer errors and reports them on the instance", async () => {
    const invoker = new Invoker();
    const errors = vi.fn();
    invoker.on("onListenerError", errors);
    const tool = invoker.register({
      name: "action",
      description: "Action.",
      sideEffects: "None.",
      args: [],
      handler: () => {},
    });
    const off = tool.onToolCallSuccess(() => {
      throw new Error("UI");
    });
    await Effect.runPromise(tool.invoke({ id: "a", arguments: {} }));
    expect(errors).toHaveBeenCalledOnce();
    off();
    await Effect.runPromise(tool.invoke({ id: "b", arguments: {} }));
    expect(errors).toHaveBeenCalledOnce();
  });

  it("accepts explicit documented void contracts", async () => {
    const invoker = new Invoker();
    const tool = invoker.register({
      name: "refresh",
      description: "Refresh.",
      sideEffects: "Updates the UI.",
      args: [],
      returns: { schema: z.void(), description: "The view was refreshed." },
      handler: () => {},
    });
    expect(
      JSON.parse((await Effect.runPromise(tool.invoke({ id: "a", arguments: {} }))).content),
    ).toEqual({ success: true });
    expect(invoker.toTools()[0]!.function.description).toContain("The view was refreshed.");
  });

  it("contains invalid results in middleware while forwarding later entries", async () => {
    const invoker = new Invoker();
    const tool = invoker.register({
      name: "positive",
      description: "Count.",
      sideEffects: "None.",
      args: [],
      returns: { schema: z.number().positive(), description: "Positive count.", validate: true },
      handler: () => -1,
    });
    const failed = vi.fn();
    tool.onAfterToolCall(failed);
    const entries = [{ tool: true }, { text: "next" }];
    async function* source() {
      yield* entries;
    }
    const output = [];
    for await (const entry of invoker.middleware(source(), {
      adapter: {
        create: () => ({
          push: (entry) => ({
            entry,
            calls: (entry as { tool?: boolean }).tool
              ? [{ id: "a", name: "positive", arguments: {} }]
              : [],
          }),
          finish: () => [],
        }),
      },
    }))
      output.push(entry);
    expect(output).toEqual(entries);
    expect(failed.mock.calls[0]![0].error.code).toBe("INVALID_RESULT");
  });

  it("requires side-effect and result documentation before registering", () => {
    const invoker = new Invoker();
    expect(() =>
      invoker.register({
        name: "action",
        description: "Action.",
        sideEffects: " ",
        args: [],
        handler: () => {},
      }),
    ).toThrow("Side effect documentation");
    expect(() =>
      invoker.register({
        name: "value",
        description: "Value.",
        sideEffects: "None.",
        args: [],
        returns: { schema: z.number(), description: " " },
        handler: () => 1,
      }),
    ).toThrow("Result documentation");
    expect(invoker.size).toBe(0);
  });
});

import { Cause, Effect, Exit } from "effect";
import { z } from "zod";
import { ToolError, failureContent } from "./errors.js";
import { Events } from "./events.js";
import { openAIAdapter } from "./openai.js";
import type {
  Argument,
  ChatTool,
  EffectRunner,
  FunctionSchema,
  InvokerOptions,
  Listener,
  MiddlewareOptions,
  ResponseTool,
  StreamAdapter,
  ToolCall,
  ToolDefinition,
  ToolEvents,
  ToolResult,
} from "./types.js";

interface Registered {
  readonly args: readonly Argument[];
  readonly validator: z.ZodType;
  readonly schema: FunctionSchema;
  readonly consume: boolean;
  readonly handler: (...args: unknown[]) => unknown;
}

function serialize(value: unknown): string {
  if (typeof value === "string") return value;
  const result = JSON.stringify(value === undefined ? null : value);
  if (result === undefined) throw new TypeError("Tool result is not JSON serializable");
  return result;
}

/** One mutable registry; each middleware iterator owns its stream state. */
export class Invoker<Requirements = never> {
  readonly #tools = new Map<string, Registered>();
  readonly #events = new Events();
  readonly #adapter: StreamAdapter;
  readonly #run: EffectRunner<Requirements>;
  #paused: boolean;

  constructor(
    ...[options = {}]: [Requirements] extends [never]
      ? [options?: InvokerOptions<Requirements>]
      : [options: InvokerOptions<Requirements> & { runEffect: EffectRunner<Requirements> }]
  ) {
    this.#paused = options.paused ?? false;
    this.#adapter = openAIAdapter(options);
    this.#run =
      options.runEffect ??
      (((effect, signal) =>
        Effect.runPromise(
          effect as Effect.Effect<unknown, ToolError>,
          signal ? { signal } : undefined,
        )) as EffectRunner<Requirements>);
  }

  get paused(): boolean {
    return this.#paused;
  }
  get size(): number {
    return this.#tools.size;
  }
  pause(): void {
    this.#paused = true;
  }
  resume(): void {
    this.#paused = false;
  }
  has(name: string): boolean {
    return this.#tools.has(name);
  }
  unregister(name: string): boolean {
    return this.#tools.delete(name);
  }

  /** Validates documentation once and caches the input JSON schema. */
  register<const Args extends readonly Argument[], Output, Error>(
    definition: ToolDefinition<Args, Output, Error, Requirements>,
  ): () => void {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(definition.name)) {
      throw new TypeError("Tool names must contain 1–64 letters, digits, underscores, or hyphens");
    }
    if (this.has(definition.name))
      throw new TypeError(`Tool already registered: ${definition.name}`);
    if (!definition.description.trim()) throw new TypeError("Tool documentation cannot be empty");
    const shape: Record<string, z.ZodType> = Object.create(null);
    const args = definition.args.map((arg) => ({ ...arg }));
    for (const arg of args) {
      if (!arg.name || !arg.description.trim())
        throw new TypeError("Arguments require names and documentation");
      if (Object.hasOwn(shape, arg.name)) throw new TypeError(`Duplicate argument: ${arg.name}`);
      shape[arg.name] = arg.schema.describe(arg.description);
    }
    const validator = z.strictObject(shape);
    const parameters = z.toJSONSchema(validator, { io: "input", target: "draft-7" });
    const registered: Registered = {
      args,
      validator,
      handler: definition.handler as Registered["handler"],
      consume: definition.consume ?? false,
      schema: {
        name: definition.name,
        description: definition.description,
        parameters,
        strict: false,
      },
    };
    this.#tools.set(definition.name, registered);
    return () => {
      if (this.#tools.get(definition.name) === registered) this.unregister(definition.name);
    };
  }

  /** OpenAI/Azure Chat Completions tools; snapshots cannot mutate the registry. */
  toTools(): ChatTool[] {
    return [...this.#tools.values()].map(({ schema }) => ({
      type: "function",
      function: structuredClone(schema),
    }));
  }

  toResponseTools(): ResponseTool[] {
    return [...this.#tools.values()].map(({ schema }) => ({
      type: "function",
      ...structuredClone(schema),
    }));
  }

  on<Key extends keyof ToolEvents>(event: Key, listener: Listener<ToolEvents[Key]>): () => void {
    return this.#events.on(event, listener);
  }

  onBeforeArgValidation(listener: Listener<ToolEvents["onBeforeArgValidation"]>): () => void {
    return this.on("onBeforeArgValidation", listener);
  }
  onBeforeToolCall(listener: Listener<ToolEvents["onBeforeToolCall"]>): () => void {
    return this.on("onBeforeToolCall", listener);
  }
  onAfterToolCall(listener: Listener<ToolEvents["onAfterToolCall"]>): () => void {
    return this.on("onAfterToolCall", listener);
  }
  onToolCallSuccess(listener: Listener<ToolEvents["onToolCallSuccess"]>): () => void {
    return this.on("onToolCallSuccess", listener);
  }
  onToolCallFail(listener: Listener<ToolEvents["onToolCallFail"]>): () => void {
    return this.on("onToolCallFail", listener);
  }

  /** Lazy, typed execution. Provide any handler services before running this Effect. */
  invoke(call: ToolCall): Effect.Effect<ToolResult, ToolError, Requirements> {
    return Effect.suspend(() => {
      const tool = this.#tools.get(call.name);
      const execute = Effect.gen({ self: this }, function* () {
        if (this.#paused) return yield* Effect.fail(new ToolError("PAUSED", "Invoker is paused"));
        if (!tool)
          return yield* Effect.fail(
            new ToolError("NOT_REGISTERED", `Tool not registered: ${call.name}`),
          );
        this.#events.emit("onBeforeArgValidation", { call });
        if (call.error) return yield* Effect.fail(call.error);
        const raw = yield* Effect.try({
          try: () =>
            typeof call.arguments === "string"
              ? (JSON.parse(call.arguments) as unknown)
              : call.arguments,
          catch: (error) =>
            new ToolError("INVALID_JSON", "Tool arguments must be valid JSON", error),
        });
        const args = yield* Effect.tryPromise({
          try: () => tool.validator.parseAsync(raw) as Promise<Record<string, unknown>>,
          catch: (error) =>
            new ToolError("INVALID_ARGUMENTS", "Tool arguments failed validation", error),
        });
        this.#events.emit("onBeforeToolCall", { call, args });
        const output = yield* Effect.try({
          try: () => tool.handler(...tool.args.map((arg) => args[arg.name])),
          catch: (error) => new ToolError("HANDLER_FAILED", "Tool handler threw an error", error),
        });
        const value = Effect.isEffect(output)
          ? yield* (output as Effect.Effect<unknown, unknown, Requirements>).pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.failCause(cause)
                  : Effect.fail(
                      new ToolError("HANDLER_FAILED", "Tool Effect failed", Cause.squash(cause)),
                    ),
              ),
            )
          : yield* Effect.tryPromise({
              try: () => Promise.resolve(output),
              catch: (error) => new ToolError("HANDLER_FAILED", "Tool promise rejected", error),
            });
        const content = yield* Effect.try({
          try: () => serialize(value),
          catch: (error) =>
            new ToolError("SERIALIZATION_FAILED", "Tool result must be JSON serializable", error),
        });
        const result: ToolResult = { call, args, value, content };
        return result;
      });
      return execute.pipe(
        Effect.catchCause((cause) => {
          const squashed = Cause.squash(cause);
          const error = Cause.hasInterruptsOnly(cause)
            ? new ToolError("CANCELLED", "Tool execution was cancelled", squashed)
            : squashed instanceof ToolError
              ? squashed
              : new ToolError("HANDLER_FAILED", "Unexpected tool execution failure", squashed);
          return Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.fail(error);
        }),
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (Exit.isSuccess(exit)) {
              this.#events.emit("onToolCallSuccess", exit.value);
              this.#events.emit("onAfterToolCall", exit.value);
            } else {
              const squashed = Cause.squash(exit.cause);
              const error = Cause.hasInterruptsOnly(exit.cause)
                ? new ToolError("CANCELLED", "Tool execution was cancelled", squashed)
                : squashed instanceof ToolError
                  ? squashed
                  : new ToolError("HANDLER_FAILED", "Unexpected tool execution failure", squashed);
              const failure = { call, error, content: failureContent(error) };
              this.#events.emit("onToolCallFail", failure);
              this.#events.emit("onAfterToolCall", failure);
            }
          }),
        ),
      );
    }) as Effect.Effect<ToolResult, ToolError, Requirements>;
  }

  /** Pull-based middleware: no prefetch, shared queues, or stream mutation. */
  async *middleware<Entry>(
    source: AsyncIterable<Entry>,
    options: MiddlewareOptions = {},
  ): AsyncGenerator<Entry, void, unknown> {
    let session: ReturnType<StreamAdapter["create"]> | undefined;
    const dispatch = async (calls: readonly ToolCall[]) => {
      for (const call of calls) {
        if (this.#paused || !this.has(call.name) || options.signal?.aborted) continue;
        // invoke emits both success and failure; settle typed failures before leaving the Effect runtime.
        await this.#run(Effect.exit(this.invoke(call)), options.signal);
      }
    };
    try {
      session = (options.adapter ?? this.#adapter).create();
      for await (const entry of source) {
        if (options.signal?.aborted) break;
        const adapted = session.push(
          entry,
          !this.#paused,
          (name) => this.#tools.get(name)?.consume ?? false,
        );
        await dispatch(adapted.calls);
        if (!adapted.consumed) yield adapted.entry as Entry;
      }
      await dispatch(session.finish());
    } catch (error) {
      if (!options.signal?.aborted) {
        this.#events.emit("onStreamError", { error });
        // Report incomplete registered calls, then preserve the source/adapter failure for the consumer.
        if (session) await dispatch(session.finish());
        throw error;
      }
    }
  }
}

import type { Effect } from "effect";
import type { z } from "zod";
import type { ToolError } from "./errors.js";

export interface Argument<Name extends string = string, Schema extends z.ZodType = z.ZodType> {
  readonly name: Name;
  readonly schema: Schema;
  readonly description: string;
}

/** Declare one named JSON argument in the handler's positional argument order. */
export function argument<const Name extends string, Schema extends z.ZodType>(
  name: Name,
  schema: Schema,
  description: string,
): Argument<Name, Schema> {
  return { name, schema, description };
}

export type ArgumentValues<Args extends readonly Argument[]> = {
  -readonly [Key in keyof Args]: Args[Key] extends Argument<string, infer Schema>
    ? z.output<Schema>
    : never;
};

export interface ToolReturn<
  Schema extends z.ZodType = z.ZodType,
  Validate extends boolean = false,
> {
  readonly schema: Schema;
  /** Explain the result and its fields to the model. */
  readonly description: string;
  /** Opt into parsing, refinements, and transforms. Default: false. */
  readonly validate?: Validate;
}

export type ToolDefinition<
  Args extends readonly Argument[],
  Schema extends z.ZodType = z.ZodVoid,
  Error = unknown,
  Requirements = never,
  Validate extends boolean = false,
> = {
  readonly name: string;
  readonly description: string;
  /** Explain reads, writes, external actions, or explicitly state "None." */
  readonly sideEffects: string;
  readonly args: Args;
  /** Remove this tool's stream entries. Default: false. */
  readonly consume?: boolean;
  readonly handler: (
    ...args: ArgumentValues<Args>
  ) =>
    | ReturnValue<NoInfer<Schema>, NoInfer<Validate>>
    | PromiseLike<ReturnValue<NoInfer<Schema>, NoInfer<Validate>>>
    | Effect.Effect<ReturnValue<NoInfer<Schema>, NoInfer<Validate>>, Error, Requirements>;
} & ([Schema] extends [z.ZodVoid]
  ? { readonly returns?: ToolReturn<Schema, Validate> }
  : { readonly returns: ToolReturn<Schema, Validate> });

export type ReturnValue<
  Schema extends z.ZodType,
  Validate extends boolean,
> = Schema extends z.ZodVoid ? void : Validate extends true ? z.input<Schema> : z.output<Schema>;

/** Service requirements are checked independently of an unknown result schema. */
export type HandlerRequirements<Output> =
  Output extends Effect.Effect<unknown, unknown, infer Requirements> ? Requirements : never;

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string | Readonly<Record<string, unknown>>;
  readonly protocol?: "chat-completions" | "responses" | "gemini" | "claude";
  /** False when a provider requires matching by name rather than a synthetic ID. */
  readonly providerCallId?: boolean;
  readonly choiceIndex?: number;
  readonly toolIndex?: number;
  /** Set by a stream adapter when a call cannot safely execute. */
  readonly error?: ToolError;
}

export interface ToolResult<Output = unknown> {
  readonly call: ToolCall;
  readonly args: Readonly<Record<string, unknown>>;
  readonly value: Output;
  /** JSON success envelope ready to return to the model. Void omits result. */
  readonly content: string;
}

/** Callable unregister handle with output types tied to this registration. */
export interface ToolRegistration<Output, Requirements = never> {
  (): void;
  invoke(call: Omit<ToolCall, "name">): Effect.Effect<ToolResult<Output>, ToolError, Requirements>;
  onToolCallSuccess(listener: Listener<ToolResult<Output>>): () => void;
  onAfterToolCall(listener: Listener<ToolResult<Output> | ToolFailure>): () => void;
}

export interface ToolFailure {
  readonly call: ToolCall;
  readonly error: ToolError;
  readonly content: string;
}

export interface ToolEvents {
  onBeforeArgValidation: { readonly call: ToolCall };
  onBeforeToolCall: { readonly call: ToolCall; readonly args: Readonly<Record<string, unknown>> };
  onAfterToolCall: ToolResult | ToolFailure;
  onToolCallSuccess: ToolResult;
  onToolCallFail: ToolFailure;
  onListenerError: { readonly event: keyof ToolEvents; readonly error: unknown };
  onStreamError: { readonly error: unknown };
}

export type Listener<Event> = (event: Event) => void | PromiseLike<void>;

export interface FunctionSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly strict: false;
  /** Schema for the full success/failure response envelope. */
  readonly resultSchema?: Record<string, unknown>;
}

export interface ChatTool {
  readonly type: "function";
  readonly function: FunctionSchema;
}

export interface ResponseTool extends FunctionSchema {
  readonly type: "function";
}

/** Structural subset accepted by both OpenAI and Azure Chat Completions SDK streams. */
export interface ChatChunk {
  readonly id: string;
  readonly choices: readonly {
    readonly index: number;
    readonly delta: {
      readonly tool_calls?: readonly {
        readonly index: number;
        readonly id?: string;
        readonly type?: string;
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }[];
    };
    readonly finish_reason: string | null;
  }[];
}

/** A new session must be created for every middleware stream. */
export interface StreamAdapter {
  create(): StreamSession;
}

/** Provider-specific declarations and result messages, alongside stream assembly. */
export interface ProviderAdapter<Tools, Result> extends StreamAdapter {
  tools(schemas: readonly FunctionSchema[]): Tools;
  result(outcome: ToolResult | ToolFailure): Result;
}

export interface AdapterOptions {
  readonly maxArgumentLength?: number;
  readonly maxPendingCalls?: number;
}

export interface StreamSession {
  /** Called with every entry, including while paused, to retain fragment boundaries. */
  push(entry: unknown, enabled: boolean, consume: (name: string) => boolean): AdaptedEntry;
  finish(): readonly ToolCall[];
}

export interface AdaptedEntry {
  readonly entry: unknown;
  readonly calls: readonly ToolCall[];
  readonly consumed?: boolean;
}

export interface MiddlewareOptions {
  readonly adapter?: StreamAdapter;
  readonly signal?: AbortSignal;
}

export type EffectRunner<Requirements> = <Output>(
  effect: Effect.Effect<Output, ToolError, Requirements>,
  signal?: AbortSignal,
) => Promise<Output>;

export interface InvokerOptions<Requirements = never> {
  readonly adapter?: StreamAdapter;
  readonly paused?: boolean;
  readonly maxArgumentLength?: number;
  readonly maxPendingCalls?: number;
  readonly runEffect?: EffectRunner<Requirements>;
}

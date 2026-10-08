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

export interface ToolDefinition<Args extends readonly Argument[], Output, Error, Requirements> {
  readonly name: string;
  readonly description: string;
  readonly args: Args;
  /** Remove this tool's stream entries. Default: false. */
  readonly consume?: boolean;
  readonly handler: (
    ...args: ArgumentValues<Args>
  ) => Output | PromiseLike<Output> | Effect.Effect<Output, Error, Requirements>;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string | Readonly<Record<string, unknown>>;
  readonly protocol?: "chat-completions" | "responses";
  readonly choiceIndex?: number;
  readonly toolIndex?: number;
  /** Set by a stream adapter when a call cannot safely execute. */
  readonly error?: ToolError;
}

export interface ToolResult {
  readonly call: ToolCall;
  readonly args: Readonly<Record<string, unknown>>;
  readonly value: unknown;
  /** JSON text, or the handler's string result, ready to return to the model. */
  readonly content: string;
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
  readonly paused?: boolean;
  readonly maxArgumentLength?: number;
  readonly maxPendingCalls?: number;
  readonly runEffect?: EffectRunner<Requirements>;
}

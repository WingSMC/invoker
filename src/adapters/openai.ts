import { ToolError } from "../errors.js";
import type {
  AdapterOptions,
  ChatTool,
  ProviderAdapter,
  ResponseTool,
  StreamSession,
  ToolCall,
} from "../types.js";

interface Pending {
  id: string;
  name: string;
  fragments: string[];
  length: number;
  enabled: boolean;
  consume: boolean;
  protocol: "chat-completions" | "responses";
  choiceIndex?: number;
  toolIndex?: number;
  error?: ToolError;
}

export interface OpenAIAdapterOptions extends AdapterOptions {
  /** Declaration/result format. Streaming accepts both protocols. Default: Chat Completions. */
  readonly protocol?: "chat-completions" | "responses";
}

export interface OpenAIChatResult {
  readonly role: "tool";
  readonly tool_call_id: string;
  readonly content: string;
}
export interface OpenAIResponseResult {
  readonly type: "function_call_output";
  readonly call_id: string;
  readonly output: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function limit(value: number | undefined, fallback: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1)
    throw new RangeError(`${name} must be a positive integer`);
  return result;
}

/** OpenAI/Azure Chat Completions and OpenAI Responses; no SDK runtime dependency. */
export function openAIAdapter(
  options: OpenAIAdapterOptions & { protocol: "responses" },
): ProviderAdapter<ResponseTool[], OpenAIResponseResult>;
export function openAIAdapter(
  options?: OpenAIAdapterOptions & { protocol?: "chat-completions" },
): ProviderAdapter<ChatTool[], OpenAIChatResult>;
export function openAIAdapter(
  options: OpenAIAdapterOptions,
): ProviderAdapter<ChatTool[] | ResponseTool[], OpenAIChatResult | OpenAIResponseResult>;
export function openAIAdapter(
  options: OpenAIAdapterOptions = {},
): ProviderAdapter<ChatTool[] | ResponseTool[], OpenAIChatResult | OpenAIResponseResult> {
  const maxLength = limit(options.maxArgumentLength, 1_048_576, "maxArgumentLength");
  const maxCalls = limit(options.maxPendingCalls, 128, "maxPendingCalls");

  return {
    tools: (schemas) => {
      const functions = schemas.map(({ name, description, parameters, strict }) => ({
        name,
        description,
        parameters: structuredClone(parameters),
        strict,
      }));
      return options.protocol === "responses"
        ? functions.map((schema) => ({ type: "function" as const, ...schema }))
        : functions.map((schema) => ({ type: "function" as const, function: schema }));
    },
    result: (outcome) =>
      options.protocol === "responses"
        ? { type: "function_call_output", call_id: outcome.call.id, output: outcome.content }
        : { role: "tool", tool_call_id: outcome.call.id, content: outcome.content },
    create(): StreamSession {
      const pending = new Map<string, Pending>();
      let exhausted = false;

      function add(key: string, call: Pending): Pending | undefined {
        if (exhausted) return undefined;
        if (pending.size >= maxCalls) {
          exhausted = true;
          for (const existing of pending.values()) {
            existing.error = new ToolError(
              "CALL_LIMIT",
              "Stream exceeded the pending tool-call limit",
            );
            existing.fragments = [];
          }
          return undefined;
        }
        pending.set(key, call);
        return call;
      }

      function append(call: Pending, fragment: string): void {
        if (!call.enabled || call.error || fragment.length === 0) return;
        call.length += fragment.length;
        if (call.length > maxLength) {
          call.error = new ToolError(
            "ARGUMENT_LIMIT",
            "Tool arguments exceeded the configured length limit",
          );
          call.fragments = [];
        } else {
          call.fragments.push(fragment);
        }
      }

      function complete(key: string, interrupted = false): ToolCall | undefined {
        const call = pending.get(key);
        if (!call) return undefined;
        pending.delete(key);
        if (!call.enabled) return undefined;
        const error =
          call.error ??
          (interrupted || !call.id || !call.name
            ? new ToolError("INCOMPLETE_CALL", "Stream ended before the tool call completed")
            : undefined);
        return {
          id: call.id,
          name: call.name,
          arguments: call.fragments.join(""),
          protocol: call.protocol,
          ...(call.choiceIndex === undefined ? {} : { choiceIndex: call.choiceIndex }),
          ...(call.toolIndex === undefined ? {} : { toolIndex: call.toolIndex }),
          ...(error ? { error } : {}),
        };
      }

      return {
        push(entry, enabled, consume) {
          if (!enabled)
            for (const call of pending.values()) {
              call.enabled = false;
              call.fragments = [];
            }
          const event = record(entry);
          if (!event) return { entry, calls: [] };
          const calls: ToolCall[] = [];

          if (Array.isArray(event.choices)) {
            let changed = false;
            const choices: unknown[] = [];
            for (const value of event.choices) {
              const choice = record(value);
              if (!choice || typeof choice.index !== "number") {
                choices.push(value);
                continue;
              }
              const prefix = `chat:${text(event.id)}:${choice.index}:`;
              const delta = record(choice.delta);
              let outputChoice = value;
              if (Array.isArray(delta?.tool_calls)) {
                const visible: unknown[] = [];
                for (const value of delta.tool_calls) {
                  const item = record(value);
                  if (
                    !item ||
                    typeof item.index !== "number" ||
                    (item.type !== undefined && item.type !== "function")
                  ) {
                    visible.push(value);
                    continue;
                  }
                  const fn = record(item.function);
                  const key = prefix + item.index;
                  const call =
                    pending.get(key) ??
                    add(key, {
                      id: "",
                      name: "",
                      fragments: [],
                      length: 0,
                      enabled,
                      consume: false,
                      protocol: "chat-completions",
                      choiceIndex: choice.index,
                      toolIndex: item.index,
                    });
                  if (!call) {
                    visible.push(value);
                    continue;
                  }
                  call.enabled &&= enabled;
                  if (item.id) call.id = text(item.id);
                  if (fn?.name) call.name += text(fn.name);
                  call.consume = consume(call.name);
                  append(call, text(fn?.arguments));
                  if (!(enabled && call.consume)) visible.push(value);
                }
                if (visible.length !== delta.tool_calls.length) {
                  changed = true;
                  const outputDelta = { ...delta };
                  if (visible.length) outputDelta.tool_calls = visible;
                  else delete outputDelta.tool_calls;
                  outputChoice = { ...choice, delta: outputDelta };
                  if (
                    Object.keys(outputDelta).length === 0 &&
                    choice.finish_reason === null &&
                    !Object.entries(choice).some(
                      ([key, value]) =>
                        key !== "index" &&
                        key !== "delta" &&
                        key !== "finish_reason" &&
                        value != null,
                    )
                  ) {
                    outputChoice = undefined;
                  }
                }
              }
              if (outputChoice !== undefined) choices.push(outputChoice);
              if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
                for (const key of pending.keys()) {
                  if (!key.startsWith(prefix)) continue;
                  const call = complete(key, choice.finish_reason !== "tool_calls");
                  if (call) calls.push(call);
                }
              }
            }
            if (!changed) return { entry, calls };
            return {
              entry: { ...event, choices },
              calls,
              consumed:
                choices.length === 0 &&
                Object.keys(event).every((key) =>
                  [
                    "id",
                    "object",
                    "created",
                    "model",
                    "choices",
                    "system_fingerprint",
                    "service_tier",
                  ].includes(key),
                ),
            };
          }

          const type = text(event.type);
          let consumed = false;
          if (type === "response.output_item.added") {
            const item = record(event.item);
            if (item?.type === "function_call") {
              const key = `response:${text(item.id)}`;
              if (!pending.has(key)) {
                const call = add(key, {
                  id: text(item.call_id),
                  name: text(item.name),
                  fragments: [],
                  length: 0,
                  enabled,
                  consume: consume(text(item.name)),
                  protocol: "responses",
                });
                if (call) append(call, text(item.arguments));
              }
              consumed = enabled && (pending.get(key)?.consume ?? false);
            }
          } else if (type === "response.function_call_arguments.delta") {
            const call = pending.get(`response:${text(event.item_id)}`);
            if (call) {
              consumed = enabled && consume(call.name);
              call.enabled &&= enabled;
              append(call, text(event.delta));
            }
          } else if (type === "response.function_call_arguments.done") {
            const call = pending.get(`response:${text(event.item_id)}`);
            if (call) {
              consumed = enabled && consume(call.name);
              call.enabled &&= enabled;
              if (typeof event.arguments === "string" && !call.error) {
                call.fragments = [];
                call.length = 0;
                append(call, event.arguments);
              }
            }
          } else if (type === "response.output_item.done") {
            const item = record(event.item);
            if (item?.type === "function_call") {
              const key = `response:${text(item.id)}`;
              const call =
                pending.get(key) ??
                add(key, {
                  id: text(item.call_id),
                  name: text(item.name),
                  fragments: [],
                  length: 0,
                  enabled,
                  consume: consume(text(item.name)),
                  protocol: "responses",
                });
              if (call) {
                consumed = enabled && consume(call.name);
                call.enabled &&= enabled;
                call.id = text(item.call_id) || call.id;
                call.name = text(item.name) || call.name;
                if (typeof item.arguments === "string" && !call.error) {
                  call.fragments = [];
                  call.length = 0;
                  append(call, item.arguments);
                }
                const result = complete(
                  key,
                  item.status !== undefined && item.status !== "completed",
                );
                if (result) calls.push(result);
              }
            }
          } else if (
            type === "response.completed" ||
            type === "response.failed" ||
            type === "response.incomplete"
          ) {
            for (const key of pending.keys()) {
              const call = complete(key, true);
              if (call) calls.push(call);
            }
          }
          return { entry, calls, consumed };
        },
        finish() {
          const calls: ToolCall[] = [];
          for (const key of pending.keys()) {
            const call = complete(key, true);
            if (call) calls.push(call);
          }
          return calls;
        },
      };
    },
  };
}

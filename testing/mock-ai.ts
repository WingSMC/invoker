/** A deterministic, credential-free AI stream for integration tests and interactive demos. */
export interface MockCall {
  readonly name: string;
  /** JSON text allows deliberately malformed arguments in validation tests. */
  readonly arguments: string | Readonly<Record<string, unknown>>;
  readonly id?: string;
}

export type MockProtocol = "chat-completions" | "responses" | "gemini" | "claude";
export interface MockRequest {
  readonly protocol?: MockProtocol;
  readonly text?: string;
  readonly calls?: readonly MockCall[];
  readonly delayMs?: number;
  readonly fragmentSize?: number;
  readonly signal?: AbortSignal;
  /** End after streaming arguments, before the completion marker. */
  readonly truncate?: boolean;
  /** Simulate a network failure after this many entries. */
  readonly failAfter?: number;
}

export interface MockAIOptions {
  /** Defaults to zero for fast, deterministic tests. */
  readonly delayMs?: number;
  readonly fragmentSize?: number;
}

export interface MockChatChunk {
  readonly id: string;
  readonly object: "chat.completion.chunk";
  readonly created: number;
  readonly model: string;
  readonly choices: readonly {
    readonly index: number;
    readonly delta: {
      readonly role?: "assistant";
      readonly content?: string;
      readonly tool_calls?: readonly {
        readonly index: number;
        readonly id?: string;
        readonly type?: "function";
        readonly function: { readonly name?: string; readonly arguments?: string };
      }[];
    };
    readonly finish_reason: "tool_calls" | "stop" | null;
  }[];
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
}

export type MockResponseEvent =
  | {
      readonly type: "response.created";
      readonly response: { readonly id: string; readonly status: "in_progress" };
    }
  | {
      readonly type: "response.output_text.delta";
      readonly item_id: string;
      readonly output_index: number;
      readonly content_index: number;
      readonly delta: string;
    }
  | {
      readonly type: "response.output_item.added" | "response.output_item.done";
      readonly output_index: number;
      readonly item: {
        readonly id: string;
        readonly call_id: string;
        readonly type: "function_call";
        readonly name: string;
        readonly arguments: string;
        readonly status: "in_progress" | "completed";
      };
    }
  | {
      readonly type: "response.function_call_arguments.delta";
      readonly item_id: string;
      readonly output_index: number;
      readonly delta: string;
    }
  | {
      readonly type: "response.function_call_arguments.done";
      readonly item_id: string;
      readonly output_index: number;
      readonly arguments: string;
      readonly name: string;
    }
  | {
      readonly type: "response.completed";
      readonly response: {
        readonly id: string;
        readonly status: "completed";
        readonly usage: {
          readonly input_tokens: number;
          readonly output_tokens: number;
          readonly total_tokens: number;
        };
      };
    };

export interface MockGeminiChunk {
  readonly candidates: readonly {
    readonly index: number;
    readonly content: {
      readonly role: "model";
      readonly parts: readonly (
        | { readonly text: string }
        | {
            readonly functionCall: {
              readonly id: string;
              readonly name: string;
              readonly args: unknown;
            };
          }
      )[];
    };
    readonly finishReason?: "STOP";
  }[];
  readonly usageMetadata?: { readonly totalTokenCount: number };
}
export interface MockClaudeEvent {
  readonly type: string;
  readonly index?: number;
  readonly content_block?:
    | { readonly type: "text"; readonly text: string }
    | {
        readonly type: "tool_use";
        readonly id: string;
        readonly name: string;
        readonly input: Record<string, unknown>;
      };
  readonly delta?: {
    readonly type?: "input_json_delta" | "text_delta";
    readonly partial_json?: string;
    readonly text?: string;
    readonly stop_reason?: "tool_use" | "end_turn";
  };
  readonly usage?: { readonly output_tokens: number };
}
export type MockEvent = MockChatChunk | MockResponseEvent | MockGeminiChunk | MockClaudeEvent;

function positive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${name} must be a positive integer`);
  return value;
}

function nonnegative(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a nonnegative integer`);
  return value;
}

function* fragments(text: string, size: number): Generator<string> {
  for (let offset = 0; offset < text.length; offset += size)
    yield text.slice(offset, offset + size);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (ms === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Scripts define model output; actual tool execution always belongs to Invoker. */
export class MockAIService {
  readonly #delay: number;
  readonly #size: number;
  #sequence = 0;

  constructor(options: MockAIOptions = {}) {
    this.#delay = nonnegative(options.delayMs ?? 0, "delayMs");
    this.#size = positive(options.fragmentSize ?? 8, "fragmentSize");
  }

  stream(request: MockRequest & { protocol: "responses" }): AsyncGenerator<MockResponseEvent>;
  stream(request: MockRequest & { protocol: "gemini" }): AsyncGenerator<MockGeminiChunk>;
  stream(request: MockRequest & { protocol: "claude" }): AsyncGenerator<MockClaudeEvent>;
  stream(request: MockRequest & { protocol?: "chat-completions" }): AsyncGenerator<MockChatChunk>;
  stream(request: MockRequest): AsyncGenerator<MockEvent>;
  async *stream(request: MockRequest): AsyncGenerator<MockEvent> {
    const delayMs = nonnegative(request.delayMs ?? this.#delay, "delayMs");
    const size = positive(request.fragmentSize ?? this.#size, "fragmentSize");
    const failAfter =
      request.failAfter === undefined ? undefined : nonnegative(request.failAfter, "failAfter");
    const sequence = ++this.#sequence;
    const id = `mock_${sequence}`;
    const calls = (request.calls ?? []).map((call, index) => ({
      ...call,
      id: call.id ?? `call_${sequence}_${index}`,
      itemId: `fc_${sequence}_${index}`,
      json: typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments),
    }));
    const events =
      request.protocol === "gemini"
        ? this.#gemini(request.text ?? "", calls, size, request.truncate ?? false)
        : request.protocol === "claude"
          ? this.#claude(request.text ?? "", calls, size, request.truncate ?? false)
          : request.protocol === "responses"
            ? this.#responses(id, request.text ?? "", calls, size, request.truncate ?? false)
            : this.#chat(id, request.text ?? "", calls, size, request.truncate ?? false);
    let count = 0;
    for (const event of events) {
      request.signal?.throwIfAborted();
      if (count === failAfter) throw new Error(`Mock network failure after ${count} entries`);
      await delay(delayMs, request.signal);
      request.signal?.throwIfAborted();
      count++;
      yield event;
    }
  }

  *#gemini(
    text: string,
    calls: readonly PreparedCall[],
    size: number,
    truncate: boolean,
  ): Generator<MockGeminiChunk> {
    for (const delta of fragments(text, Math.max(size, 16)))
      yield { candidates: [{ index: 0, content: { role: "model", parts: [{ text: delta }] } }] };
    if (calls.length)
      yield {
        candidates: [
          {
            index: 0,
            content: {
              role: "model",
              parts: calls.map((call) => ({
                functionCall: {
                  id: call.id,
                  name: call.name,
                  args: (() => {
                    try {
                      return JSON.parse(call.json) as unknown;
                    } catch {
                      return call.json;
                    }
                  })(),
                },
              })),
            },
          },
        ],
      };
    if (!truncate)
      yield {
        candidates: [{ index: 0, content: { role: "model", parts: [] }, finishReason: "STOP" }],
        usageMetadata: { totalTokenCount: 72 },
      };
  }

  *#claude(
    text: string,
    calls: readonly PreparedCall[],
    size: number,
    truncate: boolean,
  ): Generator<MockClaudeEvent> {
    yield { type: "message_start" };
    yield { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
    for (const delta of fragments(text, Math.max(size, 16)))
      yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: delta } };
    yield { type: "content_block_stop", index: 0 };
    for (const [index, call] of calls.entries())
      yield {
        type: "content_block_start",
        index: index + 1,
        content_block: { type: "tool_use", id: call.id, name: call.name, input: {} },
      };
    const queues = calls.map((call) => fragments(call.json, size));
    let more = true;
    while (more) {
      more = false;
      for (const [index, queue] of queues.entries()) {
        const next = queue.next();
        if (!next.done) {
          more = true;
          yield {
            type: "content_block_delta",
            index: index + 1,
            delta: { type: "input_json_delta", partial_json: next.value },
          };
        }
      }
    }
    if (!truncate) {
      for (let index = 0; index < calls.length; index++)
        yield { type: "content_block_stop", index: index + 1 };
      yield {
        type: "message_delta",
        delta: { stop_reason: calls.length ? "tool_use" : "end_turn" },
        usage: { output_tokens: 40 },
      };
      yield { type: "message_stop" };
    }
  }

  *#chat(
    id: string,
    text: string,
    calls: readonly PreparedCall[],
    size: number,
    truncate: boolean,
  ): Generator<MockChatChunk> {
    const chunk = (
      delta: MockChatChunk["choices"][number]["delta"],
      finish: "stop" | "tool_calls" | null = null,
    ): MockChatChunk => ({
      id,
      object: "chat.completion.chunk",
      created: 0,
      model: "invoker-mock",
      choices: [{ index: 0, delta, finish_reason: finish }],
    });
    yield chunk({ role: "assistant" });
    for (const content of fragments(text, Math.max(size, 16))) yield chunk({ content });
    const queues = calls.map((call) => fragments(call.json, size));
    if (calls.length)
      yield chunk({
        tool_calls: calls.map((call, index) => ({
          index,
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: "" },
        })),
      });
    let pending = true;
    while (pending) {
      pending = false;
      const deltas: NonNullable<MockChatChunk["choices"][number]["delta"]["tool_calls"]>[number][] =
        [];
      queues.forEach((queue, index) => {
        const next = queue.next();
        if (!next.done) {
          pending = true;
          deltas.push({ index, function: { arguments: next.value } });
        }
      });
      if (deltas.length) yield chunk({ tool_calls: deltas });
    }
    if (truncate) return;
    yield chunk({}, calls.length ? "tool_calls" : "stop");
    yield {
      ...chunk({}),
      choices: [],
      usage: { prompt_tokens: 24, completion_tokens: 48, total_tokens: 72 },
    };
  }

  *#responses(
    id: string,
    text: string,
    calls: readonly PreparedCall[],
    size: number,
    truncate: boolean,
  ): Generator<MockResponseEvent> {
    yield { type: "response.created", response: { id, status: "in_progress" } };
    for (const delta of fragments(text, Math.max(size, 16)))
      yield {
        type: "response.output_text.delta",
        item_id: `msg_${id}`,
        output_index: 0,
        content_index: 0,
        delta,
      };
    for (const [index, call] of calls.entries()) {
      const output_index = index + (text ? 1 : 0);
      const item = {
        id: call.itemId,
        call_id: call.id,
        type: "function_call" as const,
        name: call.name,
        arguments: "",
        status: "in_progress" as const,
      };
      yield { type: "response.output_item.added", output_index, item };
      for (const delta of fragments(call.json, size))
        yield {
          type: "response.function_call_arguments.delta",
          item_id: call.itemId,
          output_index,
          delta,
        };
      if (truncate) continue;
      yield {
        type: "response.function_call_arguments.done",
        item_id: call.itemId,
        output_index,
        arguments: call.json,
        name: call.name,
      };
      yield {
        type: "response.output_item.done",
        output_index,
        item: { ...item, arguments: call.json, status: "completed" },
      };
    }
    if (!truncate)
      yield {
        type: "response.completed",
        response: {
          id,
          status: "completed",
          usage: { input_tokens: 24, output_tokens: 48, total_tokens: 72 },
        },
      };
  }
}

interface PreparedCall extends MockCall {
  readonly id: string;
  readonly itemId: string;
  readonly json: string;
}

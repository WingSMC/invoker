import { Effect } from "effect";
import { z } from "zod";
import { Invoker, argument, geminiAdapter, claudeAdapter, openAIAdapter } from "../src/index.js";
import type { ToolFailure, ToolResult } from "../src/index.js";
import { MockAIService } from "../testing/mock-ai.js";
import type { MockCall, MockEvent, MockProtocol } from "../testing/mock-ai.js";

export type Scenario = "weather" | "invalid" | "unknown" | "failure" | "parallel" | "truncated";
export type Stage = "idle" | "stream" | "validate" | "execute" | "success" | "fail" | "bypass";
export interface DemoUpdate {
  readonly type: "chunk" | "event" | "stage" | "result" | "text";
  readonly label: string;
  readonly data?: unknown;
  readonly stage?: Stage;
}
export interface DemoRun {
  readonly scenario: Scenario;
  readonly city: string;
  readonly protocol: MockProtocol;
  readonly signal?: AbortSignal;
}
export interface DemoSummary {
  readonly incoming: number;
  readonly forwarded: number;
  readonly outcomes: readonly (ToolResult | ToolFailure)[];
  readonly answer: string;
}

/** Browser-free demo model: the UI observes real Invoker and mock-stream behavior. */
export class DemoSession {
  readonly invoker = new Invoker();
  readonly #mock: MockAIService;
  readonly #update: (update: DemoUpdate) => void;
  readonly #handlerDelay: number;
  readonly #validationDelay: number;
  #consume = false;
  #failure = false;
  #outcomes: (ToolResult | ToolFailure)[] = [];
  #running = false;

  constructor(
    update: (update: DemoUpdate) => void,
    options: { delayMs?: number; handlerDelayMs?: number; validationDelayMs?: number } = {},
  ) {
    this.#update = update;
    this.#handlerDelay = options.handlerDelayMs ?? 200;
    this.#validationDelay = options.validationDelayMs ?? 200;
    this.#mock = new MockAIService({ delayMs: options.delayMs ?? 200, fragmentSize: 7 });
    this.setRegistered(true);
    this.invoker.onBeforeArgValidation(({ call }) => {
      this.#update({ type: "stage", label: "Validate arguments", stage: "validate" });
      this.#update({ type: "event", label: "onBeforeArgValidation", data: call });
    });
    this.invoker.onBeforeToolCall(({ call, args }) => {
      this.#update({ type: "stage", label: "Execute handler", stage: "execute" });
      this.#update({ type: "event", label: "onBeforeToolCall", data: { name: call.name, args } });
    });
    this.invoker.onToolCallSuccess((result) => {
      this.#update({ type: "stage", label: "Tool completed", stage: "success" });
      this.#update({ type: "event", label: "onToolCallSuccess", data: result.value });
      this.#update({
        type: "result",
        label: result.call.name,
        data: JSON.parse(result.content) as unknown,
      });
    });
    this.invoker.onToolCallFail((failure) => {
      this.#update({ type: "stage", label: "Failure contained", stage: "fail" });
      this.#update({
        type: "event",
        label: "onToolCallFail",
        data: { code: failure.error.code, message: failure.error.message },
      });
      this.#update({
        type: "result",
        label: failure.call.name,
        data: JSON.parse(failure.content) as unknown,
      });
    });
    this.invoker.onAfterToolCall((outcome) => {
      this.#outcomes.push(outcome);
      this.#update({
        type: "event",
        label: "onAfterToolCall",
        data: { id: outcome.call.id, status: "error" in outcome ? "failed" : "success" },
      });
    });
  }

  setRegistered(registered: boolean): void {
    if (!registered) {
      this.invoker.unregister("get_weather");
      return;
    }
    if (this.invoker.has("get_weather")) return;
    this.invoker.register({
      name: "get_weather",
      description: "Get the current weather for a city.",
      sideEffects: "Simulates a weather lookup locally. No network requests or writes.",
      returns: {
        schema: z.object({
          city: z.string(),
          temperature: z.number(),
          unit: z.enum(["celsius", "fahrenheit"]),
          conditions: z.string(),
        }),
        description: "Current temperature in the requested unit, city, and sky conditions.",
      },
      args: [
        argument(
          "city",
          z.preprocess(async (value) => {
            await Effect.runPromise(Effect.sleep(this.#validationDelay));
            return value;
          }, z.string().min(1)),
          "City and country, e.g. Berlin, DE.",
        ),
        argument("unit", z.enum(["celsius", "fahrenheit"]).default("celsius"), "Temperature unit."),
      ],
      consume: this.#consume,
      handler: (city, unit) =>
        Effect.gen({ self: this }, function* () {
          yield* Effect.sleep(this.#handlerDelay);
          if (this.#failure)
            return yield* Effect.fail(new Error("Mock weather service unavailable"));
          return {
            city,
            temperature: unit === "celsius" ? 18 : 64,
            unit,
            conditions: "Clear skies",
          };
        }),
    });
  }

  setConsume(consume: boolean): void {
    this.#consume = consume;
    const registered = this.invoker.has("get_weather");
    this.invoker.unregister("get_weather");
    this.setRegistered(registered);
  }

  setPaused(paused: boolean): void {
    if (paused) this.invoker.pause();
    else this.invoker.resume();
  }

  async run(options: DemoRun): Promise<DemoSummary> {
    if (this.#running) throw new Error("A demo is already running");
    this.#running = true;
    this.#outcomes = [];
    this.#failure = options.scenario === "failure";
    let incoming = 0;
    let forwarded = 0;
    let answer = "";
    const signal = options.signal;
    const calls: MockCall[] =
      options.scenario === "unknown"
        ? [{ name: "search_web", arguments: { query: options.city } }]
        : [
            {
              name: "get_weather",
              arguments: {
                city: options.scenario === "invalid" ? 42 : options.city,
                unit: "celsius",
              },
            },
          ];
    if (options.scenario === "parallel")
      calls.push({ name: "get_weather", arguments: { city: "Tokyo, JP", unit: "celsius" } });
    const mock = this.#mock;
    const update = this.#update;
    async function* traced() {
      for await (const chunk of mock.stream({
        protocol: options.protocol,
        text: "Let me check the weather for you. ",
        calls,
        truncate: options.scenario === "truncated",
        ...(signal ? { signal } : {}),
      })) {
        incoming++;
        update({ type: "chunk", label: "incoming", data: chunk });
        yield chunk;
      }
    }
    try {
      this.#update({ type: "stage", label: "Receiving AI stream", stage: "stream" });
      const adapter =
        options.protocol === "gemini"
          ? geminiAdapter()
          : options.protocol === "claude"
            ? claudeAdapter()
            : openAIAdapter();
      for await (const chunk of this.invoker.middleware(traced(), {
        adapter,
        ...(signal ? { signal } : {}),
      })) {
        forwarded++;
        this.#update({ type: "chunk", label: "forwarded", data: chunk });
      }
      signal?.throwIfAborted();
      if (!this.#outcomes.length) {
        this.#update({ type: "stage", label: "Tool call passed through", stage: "bypass" });
        answer =
          options.scenario === "unknown"
            ? "search_web is not registered. Its call passed through for another handler to pick up."
            : this.invoker.paused
              ? "Middleware is paused. All entries passed through; no tools ran."
              : "No tool executed. Calls to unregistered tools, or calls that cross a pause, pass through.";
      } else if (this.#outcomes.some((outcome) => "error" in outcome)) {
        answer =
          "The tool failure was contained. The stream stayed open, and the UI received a typed error.";
      } else {
        answer = this.#outcomes
          .map((outcome) => {
            if (!("value" in outcome)) return "";
            const weather = outcome.value as {
              city: string;
              temperature: number;
              conditions: string;
            };
            return `${weather.city}: ${weather.temperature}°C, ${weather.conditions.toLowerCase()}.`;
          })
          .join(" ");
      }
      // A second mock model turn is scripted from the actual tool outcomes.
      for await (const chunk of mock.stream({
        protocol: options.protocol,
        text: answer,
        ...(signal ? { signal } : {}),
      })) {
        const delta = textDelta(chunk);
        if (delta) this.#update({ type: "text", label: "answer", data: delta });
      }
      return { incoming, forwarded, outcomes: [...this.#outcomes], answer };
    } finally {
      this.#running = false;
    }
  }
}

export function textDelta(event: MockEvent): string {
  if ("candidates" in event)
    return event.candidates
      .flatMap((candidate) => candidate.content.parts)
      .map((part) => ("text" in part ? part.text : ""))
      .join("");
  return "choices" in event
    ? (event.choices[0]?.delta.content ?? "")
    : event.type === "response.output_text.delta"
      ? typeof event.delta === "string"
        ? event.delta
        : ""
      : event.type === "content_block_delta" && "delta" in event && typeof event.delta === "object"
        ? (event.delta?.text ?? "")
        : "";
}

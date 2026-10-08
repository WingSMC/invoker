# invoker

A small TypeScript npm library for registering documented functions and invoking them from AI chat streams. Zod validates arguments; Effect tracks execution errors and service requirements.

- Positional handler arguments inferred from an ordered list of named Zod validators.
- Plain functions, promises, and Effects, including Effects with typed service dependencies.
- OpenAI/Azure Chat Completions and OpenAI Responses streaming support.
- Runtime registration, unregistration, pause/resume, and isolated lifecycle events.
- Original stream entries preserved by default; opt into consumption per tool.
- Pull-based iteration, bounded fragment buffers, no SDK runtime dependency, no Node-specific runtime APIs.

## Install

```sh
pnpm add invoker effect zod
```

Effect (`^4.0.2`) and Zod (`^4.6.5`) are required peer dependencies supplied by your application. They are also development dependencies here for builds and tests. The package is ESM, targets ES2022, and includes TypeScript declarations. OpenAI and Vite+ are development dependencies only.

## Register a tool

```ts
import { Invoker, argument } from "invoker";
import { Effect } from "effect";
import { z } from "zod";

const invoker = new Invoker();

const unregister = invoker.register({
  name: "get_weather",
  description: "Get the weather for a city.",
  args: [
    argument("city", z.string().min(1), "City and country, for example Berlin, DE."),
    argument("unit", z.enum(["celsius", "fahrenheit"]).default("celsius"), "Temperature unit."),
  ],
  // city: string, unit: "celsius" | "fahrenheit"
  handler: (city, unit) => Effect.succeed({ city, unit, temperature: 18 }),
  consume: false, // default: preserve this tool's original stream entries
});

invoker.onBeforeArgValidation(({ call }) => console.log("Validating", call.name));
invoker.onBeforeToolCall(({ call, args }) => console.log("Running", call.name, args));
invoker.onToolCallSuccess(({ call, value }) => console.log("Completed", call.id, value));
invoker.onToolCallFail(({ call, error }) => console.error("Failed", call.id, error.code));
invoker.onAfterToolCall((event) => console.log("Settled", event.call.id));

// Register/unregister whenever needed.
unregister(); // also: invoker.unregister("get_weather")
invoker.pause();
invoker.resume();
```

The model supplies a JSON object with named properties. Arguments are validated together and passed to the handler in the order declared in `args`. Handler types use the schemas' **output** types, so transforms, defaults, and optional values work. Async refinements are supported. Unexpected properties fail validation. Empty `args: []` supports zero-argument functions.

`argument()` is a convenience helper; `{ name, schema, description }` works too. Tool and argument documentation are required. Registration caches the generated input JSON schema and rejects duplicate tool names, duplicate argument names, unsupported JSON schemas, and invalid tool names. Names follow OpenAI's 1–64 character letters/digits/underscore/hyphen format.

Definitions use `strict: false` in provider requests so optional/defaulted Zod input schemas retain their semantics. Local validation always runs. Provider schema support may be narrower than Zod's JSON Schema support; use JSON-representable input schemas for tools.

## OpenAI / Azure Chat Completions

```ts
import OpenAI from "openai";
import type { ToolFailure, ToolResult } from "invoker";

const client = new OpenAI();
// An AzureOpenAI client using the same Chat Completions interface works too.
const completed: (ToolResult | ToolFailure)[] = [];
const off = invoker.onAfterToolCall((result) => {
  completed.push(result);
});

const stream = await client.chat.completions.create({
  model: "YOUR_CHAT_COMPLETIONS_MODEL_OR_DEPLOYMENT",
  messages: [{ role: "user", content: "What's the weather in Berlin?" }],
  tools: invoker.toTools(),
  stream: true,
});

for await (const chunk of invoker.middleware(stream)) {
  // Text, usage, filtering metadata, and unknown tools remain available.
  for (const choice of chunk.choices) {
    if (choice.delta.content) process.stdout.write(choice.delta.content);
  }
}
off();

const toolMessages = completed.map(({ call, content }) => ({
  role: "tool" as const,
  tool_call_id: call.id,
  content,
}));
```

Before the next request, append the complete assistant message containing **all** tool calls, followed by the corresponding tool messages. Route unknown tools to their own handlers. The library executes registered tools and exposes their results; your application owns message history, additional requests, and the model/tool loop. Consuming stream fragments requires reconstructing handled assistant tool calls from event `call` values. Multiple chat choices have separate calls; use `call.choiceIndex` to maintain separate conversation branches.

Use SDK-decoded async iterables. Raw HTTP/SSE bytes need decoding before middleware. Streamed JSON is parsed once, after `finish_reason: "tool_calls"`. Truncated/content-filtered calls produce `INCOMPLETE_CALL`; they never execute. Text and non-tool deltas are forwarded immediately when pulled. Calls completing in the same chunk run sequentially before that chunk is yielded. A slow tool therefore applies backpressure to subsequent reads.

See the [official OpenAI function calling guide](https://developers.openai.com/api/docs/guides/function-calling#streaming) for fragmented deltas and the follow-up request format.

## OpenAI Responses

```ts
const outputs: { type: "function_call_output"; call_id: string; output: string }[] = [];
const offResponses = invoker.onAfterToolCall(({ call, content }) => {
  if (call.protocol === "responses") {
    outputs.push({ type: "function_call_output", call_id: call.id, output: content });
  }
});

const responseStream = await client.responses.create({
  model: "YOUR_RESPONSES_MODEL",
  input: "What's the weather in Berlin?",
  tools: invoker.toResponseTools(),
  stream: true,
});

for await (const event of invoker.middleware(responseStream)) {
  // Consume text, reasoning, response metadata, etc. in your application.
}
offResponses();
```

Execution waits for `response.output_item.done`, uses `call_id` for tool results, and does not execute again at `response.completed`. Return `outputs` with the previous response ID, or retain complete output items (including reasoning) in your next input. Azure support covers compatible Chat Completions streams; Responses support depends on the provider/deployment.

## Pause and consume

Set `consume: true` on a tool definition to remove its tool-call fragments. It defaults to `false`. Mixed Chat Completions chunks are copied only when filtering is necessary; their text, unregistered calls, choice metadata, usage, and Azure filtering data remain. Responses function-call entries for consuming tools are suppressed; response-wide completion metadata remains.

Paused middleware forwards original entries, runs no tools, and emits no tool lifecycle events. Calls whose fragments cross a pause are skipped even if resumed before completion. Unregistering stops dispatch and consumption of subsequent fragments. In-flight handlers already started are allowed to finish; abort the middleware to interrupt Effects. The function chosen at the start of `invoke()` is stable through validation and execution. A pause/resume entirely between two pulls cannot be observed by the adapter.

Stream state is isolated per `middleware()` iterator. Registration is checked at dispatch time. No executions are shared or deduplicated across separate streams; replaying a stream can run its tools again.

## Effect execution and services

```ts
const result = await Effect.runPromise(
  invoker.invoke({
    id: "manual_1",
    name: "get_weather",
    arguments: { city: "Berlin" }, // JSON text is also accepted
  }),
);
```

`invoke()` is lazy and returns `Effect<ToolResult, ToolError, Requirements>`. Failed validation, thrown errors, rejected promises, failed/defective Effects, and serialization failures stay in the typed error channel. Middleware settles tool failures and continues reading. Source, adapter, and custom-runner failures emit `onStreamError` and propagate to the consumer. Interrupted execution preserves Effect interruption and emits `CANCELLED` lifecycle events.

Declare services on the instance and provide a typed runner:

```ts
import { Context, Effect } from "effect";

class Database extends Context.Service<
  Database,
  {
    lookup: (id: number) => string;
  }
>()("Database") {}

const withDatabase = new Invoker<Database>({
  runEffect: (effect, signal) =>
    Effect.runPromise(
      effect.pipe(Effect.provideService(Database, { lookup: (id) => `record:${id}` })),
      signal ? { signal } : undefined,
    ),
});

withDatabase.register({
  name: "lookup",
  description: "Look up a record.",
  args: [argument("id", z.number(), "Record ID.")],
  handler: (id) =>
    Effect.gen(function* () {
      return (yield* Database).lookup(id);
    }),
});
```

A default `Invoker` rejects handlers with unprovided service requirements at compile time. Supply all instance requirements before running `invoke()` directly.

## Events and errors

Each subscription returns an unsubscribe function. Convenience methods and `on("onBeforeToolCall", listener)` are equivalent.

| Event                   | Payload                                               |
| ----------------------- | ----------------------------------------------------- |
| `onBeforeArgValidation` | `{ call }`                                            |
| `onBeforeToolCall`      | `{ call, args }` with validated/transformed arguments |
| `onToolCallSuccess`     | `{ call, args, value, content }`                      |
| `onToolCallFail`        | `{ call, error, content }`                            |
| `onAfterToolCall`       | Success or failure payload, once after settlement     |
| `onListenerError`       | `{ event, error }`                                    |
| `onStreamError`         | `{ error }`                                           |

Observers run synchronously when emitted; returned promises are observed for rejection but are not awaited. Listener failures cannot break tools or other listeners. A failing `onListenerError` listener is contained without recursively emitting itself. Async observers can finish after iteration; perform essential result collection synchronously. Payloads are read-only in TypeScript; observers should not mutate them at runtime.

Success order: before validation → before call → success → after call. Validation failures omit the before-call event. Middleware ignores unknown tools and disabled calls; direct `invoke()` returns `NOT_REGISTERED` or `PAUSED` failures instead.

`ToolError` exposes `code`, `message`, and `detail` (the original exception or Zod validation error). Codes are `NOT_REGISTERED`, `PAUSED`, `INVALID_JSON`, `INVALID_ARGUMENTS`, `HANDLER_FAILED`, `SERIALIZATION_FAILED`, `INCOMPLETE_CALL`, `ARGUMENT_LIMIT`, `CALL_LIMIT`, and `CANCELLED`. Error result `content` contains only a code and generic message; original exception details stay local. Success `content` is a string result verbatim or JSON (`undefined` becomes `null`). Circular values and BigInts fail serialization.

## Limits, cancellation, and adapters

```ts
const bounded = new Invoker({
  maxArgumentLength: 1_048_576, // default: UTF-16 code units per call
  maxPendingCalls: 128, // default: in-flight calls per stream
});

const controller = new AbortController();
const wrapped = bounded.middleware(stream, { signal: controller.signal });
```

Limits must be positive integers. Argument limits clear the buffered arguments and report an error at completion. Exceeding the pending-call limit fails tracked calls and stops buffering new calls for that stream; original entries keep flowing. Built-in limits apply to streamed arguments, including unknown calls. Direct invocation accepts already-complete input.

Aborting interrupts active Effects and closes the source when iteration resumes. Effect-based HTTP operations can cooperate with interruption. Plain synchronous functions and already-started promises cannot be forcibly stopped. To unblock a pending network read, also pass the same signal to the SDK request. Breaking iteration closes the underlying iterator and abandons incomplete calls without executing them.

The built-in `openAIAdapter()` is exported. To support another provider, pass `{ adapter }` to `middleware()`. A `StreamAdapter` creates a new session per stream. Its `push(entry, enabled, consume)` returns `{ entry, calls, consumed? }`: normalized **complete** `ToolCall`s, the forwarded entry, and an optional suppression flag. `finish()` reports incomplete pending calls using `call.error`. Adapters own provider fragment assembly and consumption; the registry, validation, execution, and events stay unchanged.

## Development

```sh
vp install
vp run check   # formatting, lint, TypeScript 7 native compiler
vp test        # offline unit/stream tests
vp run build  # Vite+ Pack ESM build + TS7 declaration generation
vp pm pack    # npm tarball; runs prepack
```

Type checking uses stable `typescript` 7 (`tsc`). Vite+ Pack emits bundled declarations using its `tsgo` generator with the same compiler package. Vite+ manages builds, tests, formatting, linting, and pnpm. Runtime tests and compile-only SDK/type contracts require no credentials or live API requests.

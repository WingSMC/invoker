# invoker

[Live demo and documentation](https://wingsmc.github.io/invoker/)

A small TypeScript npm library for registering documented functions and invoking them from AI chat streams. Zod validates arguments; Effect tracks execution errors and service requirements. Result schemas provide types and model context, with optional runtime validation.

- Positional handler arguments inferred from an ordered list of named Zod validators.
- Documented result schemas, typed registration handles, and explicit side-effect context for the model.
- Plain functions, promises, and Effects, including Effects with typed service dependencies.
- Adapters for OpenAI/Azure Chat Completions, OpenAI Responses, Gemini, and Claude streams.
- Runtime registration, unregistration, pause/resume, and isolated lifecycle events.
- Original stream entries preserved by default; opt into consumption per tool.
- Pull-based iteration, bounded fragment buffers, no SDK runtime dependency, no Node-specific runtime APIs.

## Install

```sh
pnpm add invoker effect zod
```

Effect (`^4.0.2`) and Zod (`^4.6.5`) are required peer dependencies supplied by your application. They are also development dependencies here for builds and tests. The package is ESM, targets ES2022, and includes TypeScript declarations. Provider SDKs are development dependencies for compatibility checks and examples; choose the SDKs your application needs.

## Register a tool

```ts
import { Invoker, argument } from "invoker";
import { Effect } from "effect";
import { z } from "zod";

const invoker = new Invoker();

const unregister = invoker.register({
  name: "get_weather",
  description: "Get the weather for a city.",
  sideEffects: "Reads weather data. No writes or external actions.",
  returns: {
    schema: z.object({
      city: z.string(),
      unit: z.enum(["celsius", "fahrenheit"]),
      temperature: z.number(),
    }),
    description: "Current temperature for the city in the requested unit.",
  },
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
// unregister(); // also: invoker.unregister("get_weather")
invoker.pause();
invoker.resume();
```

The model supplies a JSON object with named properties. Arguments are validated together and passed to the handler in the order declared in `args`. Handler types use the schemas' **output** types, so transforms, defaults, and optional values work. Async refinements are supported. Unexpected properties fail validation. Empty `args: []` supports zero-argument functions.

`argument()` is a convenience helper; `{ name, schema, description }` works too. Tool, argument, side-effect, and declared result documentation are required. Use `sideEffects: "None."` for pure functions; explain external reads, writes, notifications, or UI changes otherwise. Registration caches the input and output JSON schemas and rejects duplicate tool names, duplicate argument names, unsupported JSON schemas, and invalid tool names. Names follow OpenAI's 1–64 character letters/digits/underscore/hyphen format.

Definitions use `strict: false` in provider requests so optional/defaulted Zod input schemas retain their semantics. Local validation always runs. Provider schema support may be narrower than Zod's JSON Schema support; use JSON-representable input schemas for tools.

## Results and model context

Declare `returns: { schema, description }` for value-returning handlers. By default, the handler must return the schema's **output** type, and its value is trusted: no result parsing, refinement, cloning, or transformation runs. Typed invocation and per-tool success events expose that output type. JSON serialization still runs to prepare the model response.

Set `returns.validate: true` to opt into async result validation and transformations. In that mode the handler returns the schema's **input** type, and events expose its parsed **output** type. Invalid results fail with `INVALID_RESULT`. Side effects may already have occurred; failure does not imply rollback.

All adapters include `sideEffects`, result documentation, the output JSON schema (including field `.describe()` text), and success/failure semantics in the tool description. Gemini additionally receives the response envelope schema in `responseJsonSchema`.

Omitting `returns` declares a void handler. Successful void actions produce `content: '{"success":true}'`; value-returning tools produce `'{"success":true,"result":...}'`. Failures produce `'{"success":false,"error":{"code":...,"message":...}}'`. `value` stays the handler's original value for your UI unless validation is enabled. Void tools ignore any accidental value; explicitly enable validation with `returns: { schema: z.void(), description: "No value.", validate: true }` to reject it.

The callable unregister handle provides typed invocation and per-tool subscriptions:

```ts
unregister.onToolCallSuccess(({ value }) => {
  console.log(value.temperature); // number, inferred from returns.schema
});
const result = await Effect.runPromise(
  unregister.invoke({
    id: "weather_1",
    arguments: { city: "Berlin" },
  }),
);
console.log(result.value.temperature); // number

invoker.register({
  name: "refresh_view",
  description: "Refresh the visible view.",
  sideEffects: "Updates the UI. No persistent writes.",
  args: [],
  handler: () => {
    refreshView();
  }, // returns defaults to void
});
```

The handle's `onAfterToolCall` receives the typed success or a `ToolFailure`. Handles stay tied to their original registration and cannot invoke or observe replacements under the same name. Global instance results remain `unknown` because unrelated tools share the mutable registry. Send each outcome's `content` back in the next model request; middleware does not issue requests itself.

## Provider adapters

The registry and Effect execution are shared; adapters own provider declarations, result messages, and stream assembly. OpenAI/Azure support lives in `src/adapters/openai.ts`, alongside `gemini.ts` and `claude.ts`.

| Factory                                    | Input stream                    | `invoker.toTools(adapter)` | `adapter.result(outcome)`           |
| ------------------------------------------ | ------------------------------- | -------------------------- | ----------------------------------- |
| `openAIAdapter()`                          | Chat Completions / Azure chunks | Function tools             | `role: "tool"` message              |
| `openAIAdapter({ protocol: "responses" })` | Responses events                | Responses function tools   | `function_call_output` item         |
| `geminiAdapter()`                          | GenerateContent chunks          | `functionDeclarations`     | `functionResponse` part             |
| `claudeAdapter()`                          | Messages raw events             | `input_schema` tools       | `tool_result` block with `is_error` |

Pass the same adapter to tool export and middleware. `new Invoker({ adapter })` sets the instance's default **stream** adapter; declarations are selected explicitly with `toTools(adapter)`. Calling `toTools()` keeps its OpenAI Chat Completions default, and `toResponseTools()` remains a convenience method. Each adapter accepts `maxArgumentLength` and `maxPendingCalls`; configure limits on the adapter when supplying one explicitly.

## OpenAI / Azure Chat Completions

```ts
import OpenAI from "openai";
import { openAIAdapter } from "invoker";
import type { ToolFailure, ToolResult } from "invoker";

const client = new OpenAI();
const adapter = openAIAdapter();
// An AzureOpenAI client using the same Chat Completions interface works too.
const completed: (ToolResult | ToolFailure)[] = [];
const off = invoker.onAfterToolCall((result) => {
  completed.push(result);
});

const stream = await client.chat.completions.create({
  model: "YOUR_CHAT_COMPLETIONS_MODEL_OR_DEPLOYMENT",
  messages: [{ role: "user", content: "What's the weather in Berlin?" }],
  tools: invoker.toTools(adapter),
  stream: true,
});

for await (const chunk of invoker.middleware(stream, { adapter })) {
  // Text, usage, filtering metadata, and unknown tools remain available.
  for (const choice of chunk.choices) {
    if (choice.delta.content) process.stdout.write(choice.delta.content);
  }
}
off();

const toolMessages = completed.map(adapter.result);
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

## Gemini

```ts
import { GoogleGenAI } from "@google/genai";
import type { Content, Part } from "@google/genai";
import { geminiAdapter } from "invoker";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const adapter = geminiAdapter();
const contents: Content[] = [{ role: "user", parts: [{ text: "What's the weather in Berlin?" }] }];
const parts: Part[] = [];
const results: Part[] = [];
const off = invoker.onAfterToolCall((outcome) => {
  results.push(adapter.result(outcome));
});
const config = { tools: invoker.toTools(adapter), candidateCount: 1 };
const stream = await ai.models.generateContentStream({ model, contents, config });
for await (const chunk of invoker.middleware(stream, { adapter })) {
  parts.push(...(chunk.candidates?.[0]?.content?.parts ?? []));
}
off();

// When results exist, preserve complete model parts, including thoughtSignature.
if (results.length) {
  contents.push({ role: "model", parts }, { role: "user", parts: results });
  const answer = await ai.models.generateContent({ model, contents, config });
}
```

Complete JSON `functionCall` parts execute after the candidate's `finishReason: "STOP"`. Other finish reasons or missing completion markers fail pending calls with `INCOMPLETE_CALL`. Calls with no provider ID get a local lifecycle ID; their `functionResponse` omits that synthetic ID and retains the function name. Preserve all model parts and signatures. Multiple candidates need separate history branches using `call.choiceIndex`.

This adapter handles Gemini GenerateContent streams, including parallel complete function calls. Gemini Live events and Vertex `partialArgs`/`willContinue` argument streaming need separate adapters; partial Vertex calls are rejected without executing. See the [typed SDK example](examples/gemini.ts).

## Claude

```ts
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { claudeAdapter } from "invoker";

const client = new Anthropic();
const adapter = claudeAdapter();
const messages: MessageParam[] = [{ role: "user", content: "What's the weather in Berlin?" }];
const results: ToolResultBlockParam[] = [];
const off = invoker.onAfterToolCall((outcome) => {
  results.push(adapter.result(outcome));
});
const tools = invoker.toTools(adapter);
const stream = client.messages.stream({ model, messages, tools, max_tokens: 1024 });
for await (const event of invoker.middleware(stream, { adapter })) {
  // Render text, thinking, or other events as needed.
}
off();
const assistant = await stream.finalMessage();
if (results.length) {
  messages.push(
    { role: "assistant", content: assistant.content },
    { role: "user", content: results },
  );
  const answer = await client.messages.create({ model, messages, tools, max_tokens: 1024 });
}
```

The adapter assembles client `tool_use` blocks by index, joins `input_json_delta` fragments, and dispatches at `content_block_stop`. Message termination before a block closes fails it with `INCOMPLETE_CALL`. Thinking/signature deltas and server tools remain untouched. Result blocks match `tool_use_id` and set `is_error` for failures. Keep the SDK's complete assistant content, including thinking and signatures, before sending results in the next user message. See the [typed SDK example](examples/claude.ts).

These examples advertise registered tools only and perform one tool round. Applications own round limits and must resolve unknown tool calls if any appear. Collect outcomes synchronously and unsubscribe in `finally` in production code. Keep the full assistant content before middleware filtering if opting into consumption.

## Pause and consume

Set `consume: true` on a tool definition to remove its tool-call fragments. It defaults to `false`. Mixed Chat Completions chunks are copied only when filtering is necessary; their text, unregistered calls, choice metadata, usage, and Azure filtering data remain. Responses function-call entries for consuming tools are suppressed; response-wide completion metadata remains. Gemini removes handled function-call parts while retaining surrounding candidate metadata and unrelated parts. Claude suppresses handled client tool start/argument/stop events while retaining message-wide events and other blocks.

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

`invoke()` is lazy and returns `Effect<ToolResult, ToolError, Requirements>`. Argument validation failures, opt-in result validation failures, thrown errors, rejected promises, failed/defective Effects, and serialization failures stay in the typed error channel. Middleware settles tool failures and continues reading. Source, adapter, and custom-runner failures emit `onStreamError` and propagate to the consumer. Interrupted execution preserves Effect interruption and emits `CANCELLED` lifecycle events.

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
  sideEffects: "Reads a database record. No writes.",
  returns: { schema: z.string(), description: "The matching record." },
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

`ToolError` exposes `code`, `message`, and `detail` (the original exception or Zod validation error). Codes are `NOT_REGISTERED`, `PAUSED`, `INVALID_JSON`, `INVALID_ARGUMENTS`, `HANDLER_FAILED`, `INVALID_RESULT`, `SERIALIZATION_FAILED`, `INCOMPLETE_CALL`, `ARGUMENT_LIMIT`, `CALL_LIMIT`, and `CANCELLED`. Failure `content` contains a success flag, code, and generic message; original exception details stay local. Success `content` is the JSON envelope described above. Circular values and BigInts fail serialization.

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

All three adapter factories are exported from `invoker`. To support another protocol, implement a `StreamAdapter`, which creates a new session per stream. Its `push(entry, enabled, consume)` returns `{ entry, calls, consumed? }`: normalized **complete** `ToolCall`s, the forwarded entry, and an optional suppression flag. `finish()` reports incomplete pending calls using `call.error`. A `ProviderAdapter<Tools, Result>` additionally implements `tools(schemas)` and `result(outcome)` for provider declarations and response formatting.

## Development

```sh
vp install
vp run check   # formatting, lint, TypeScript 6 + Svelte checks
vp test        # offline unit/stream tests
vp run build  # Vite+ Pack ESM build + declaration generation
vp pm pack    # npm tarball; runs prepack
```

Type checking and declaration generation use TypeScript 6. Vite+ manages builds, tests, formatting, linting, and pnpm. Runtime tests and compile-only SDK/type contracts require no credentials or live API requests.

## Demo website

The [Svelte 5 + Tailwind 4 site](https://wingsmc.github.io/invoker/) uses the actual library with the internal mock AI service. SVG packets animate the tool-routing diagram; the playground displays streamed arguments, validation, results, and lifecycle events. Syntax-highlighted code tabs show registration, SDK streaming, events, and mock usage, with provider examples and result documentation. It works without credentials or a backend, supports narrow screens and reduced motion, and makes no external font or AI requests.

The size badge is injected through `import.meta.env.VITE_INVOKER_GZIP_KB` by Vite configuration. It measures gzip bytes of the concrete `dist/index.js` build in decimal KB, rounded to one decimal place. External peers, TypeScript declarations, and source maps are excluded; this is the full ESM library artifact, not the npm tarball. Development and site build scripts build the library first, so the badge matches that build. Restart site development after library changes to refresh the measurement.

```sh
vp run dev           # local demo with hot reload (http://127.0.0.1:5173)
vp run site:check    # check Svelte and TypeScript
vp run site:build    # static site in site-dist/
vp run site:preview  # preview the production site
vp exec playwright install chromium
vp run test:e2e      # production-site browser checks; build it first
```

`testing/mock-ai.ts` is shared by unit tests and the website, and is excluded from the npm package. `MockAIService.stream()` scripts Chat Completions, Responses, Gemini, or Claude events, including text, tool calls, usage, invalid arguments, truncation, a simulated network failure (`failAfter`), and abortable delays. OpenAI/Claude formats exercise fragmented/interleaved JSON; Gemini emits complete function-call parts. Defaults are deterministic and zero-latency for tests. `site/demo.ts` connects those streams to real registered Effect handlers. The UI's second mock response is scripted from their actual outcomes.

The [GitHub Pages workflow](.github/workflows/pages.yml) checks pull requests and builds/deploys pushes to `main` (also supports manual dispatch). It uses `site-dist/` as the Pages artifact, separate from the npm library's `dist/`. Relative asset URLs support repository Pages paths and custom domains. Set the repository's **Settings → Pages → Source** to **GitHub Actions** once, then push to `main`. The expected project URL is https://wingsmc.github.io/invoker/.

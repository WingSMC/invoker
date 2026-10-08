# Invoker

[Live demo and documentation](https://wingsmc.github.io/invoker/)

A small TypeScript npm library that registers documented functions and invokes them from AI chat streams. Zod validates arguments. Effect tracks execution errors and service requirements. Result schemas provide types and model context, with optional runtime validation.

- Infer positional arguments from an ordered list of named Zod validators.
- Document results and side effects for the model. Invoke tools and observe results through typed registration handles.
- Use plain functions, promises, or Effects with typed service dependencies.
- Adapt OpenAI/Azure Chat Completions, OpenAI Responses, Gemini, and Claude streams.
- Register, unregister, pause, and resume tools at runtime. Observe isolated lifecycle events.
- Preserve original stream entries by default. Enable consumption per tool to remove its entries.
- Read streams through pull-based iteration with bounded fragment buffers. The library has no SDK runtime dependency and uses no Node-specific runtime APIs.

## Install

```sh
pnpm add @wingsmc/invoker effect zod
```

Your application must supply Effect (`^4.0.2`) and Zod (`^4.6.5`) as peer dependencies. This repository also uses them for builds and tests.

The package uses ESM, targets ES2022, and includes TypeScript declarations. Provider SDKs are development dependencies for compatibility checks and examples. Install only the SDKs your application needs.

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

The model supplies a JSON object with named properties. Invoker validates arguments together, then passes them to the handler in `args` order.

- Handler arguments use the schemas' **output** types, including transforms, defaults, and optional values.
- Validation supports async refinements and rejects unexpected properties.
- Use `args: []` for zero-argument functions.

Use `argument()` or write `{ name, schema, description }` directly. Document each tool, argument, side effect, and declared result. For pure functions, use `sideEffects: "None."`. Otherwise, describe external reads, writes, notifications, or UI changes.

Registration caches input and output JSON schemas. It rejects:

- Duplicate tool or argument names.
- Unsupported JSON schemas.
- Invalid tool names. OpenAI allows 1–64 characters: letters, digits, underscores, and hyphens.

Provider definitions use `strict: false` to preserve optional and defaulted Zod inputs. Local validation always runs. Providers may support fewer JSON Schema features than Zod. Use input schemas that JSON Schema can represent.

## Results and model context

Declare `returns: { schema, description }` for handlers that return values.

By default, the handler must return the schema's **output** type. Invoker trusts the value without parsing, refinements, cloning, or transforms. Typed invocation and per-tool success events expose that type. Invoker still serializes the result for the model.

Set `returns.validate: true` for async result validation and transforms. The handler then returns the schema's **input** type. Events expose the parsed **output** type. Invalid results fail with `INVALID_RESULT`. Side effects may already have occurred. Failure does not imply rollback.

Each adapter includes these details in the tool description:

- `sideEffects` and result documentation.
- The output JSON schema, including field `.describe()` text.
- Success and failure semantics.

Gemini also receives the response envelope schema in `responseJsonSchema`.

Omit `returns` to declare a void handler. Invoker formats `content` as follows:

| Outcome       | `content`                                                |
| ------------- | -------------------------------------------------------- |
| Void success  | `'{"success":true}'`                                     |
| Value success | `'{"success":true,"result":...}'`                        |
| Failure       | `'{"success":false,"error":{"code":...,"message":...}}'` |

Without validation, `value` retains the handler's original value for your UI. Void tools ignore accidental return values. To reject them, use `returns: { schema: z.void(), description: "No value.", validate: true }`.

The callable unregister handle supports typed invocation and per-tool subscriptions:

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

The handle's `onAfterToolCall` receives a typed success or `ToolFailure`. Handles belong to their original registration. They cannot invoke or observe replacements with the same name. Global instance results remain `unknown` because unrelated tools share the mutable registry.

Send each outcome's `content` in the next model request. Middleware does not send requests.

## Provider adapters

Adapters share the registry and Effect execution. Each adapter creates provider declarations, formats results, and assembles stream fragments. The implementations are `src/adapters/openai.ts`, `gemini.ts`, and `claude.ts`. The OpenAI adapter also supports Azure.

| Factory                                    | Input stream                    | `invoker.toTools(adapter)` | `adapter.result(outcome)`           |
| ------------------------------------------ | ------------------------------- | -------------------------- | ----------------------------------- |
| `openAIAdapter()`                          | Chat Completions / Azure chunks | Function tools             | `role: "tool"` message              |
| `openAIAdapter({ protocol: "responses" })` | Responses events                | Responses function tools   | `function_call_output` item         |
| `geminiAdapter()`                          | GenerateContent chunks          | `functionDeclarations`     | `functionResponse` part             |
| `claudeAdapter()`                          | Messages raw events             | `input_schema` tools       | `tool_result` block with `is_error` |

Pass the same adapter to tool export and middleware.

- `new Invoker({ adapter })` sets the default **stream** adapter only.
- `toTools(adapter)` selects the adapter for declarations. Without an argument, `toTools()` defaults to OpenAI Chat Completions.
- `toResponseTools()` exports OpenAI Responses tools.

Each adapter accepts `maxArgumentLength` and `maxPendingCalls`. When you supply an adapter explicitly, set its limits on that adapter.

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

Before the next request:

1. Append the complete assistant message with **all** tool calls.
2. Append the corresponding tool messages.
3. Route unknown calls to their own handlers.

Invoker executes registered tools and exposes results. Your application manages history, additional requests, and the model/tool loop. If you consume fragments, reconstruct handled assistant calls from event `call` values. For multiple chat choices, use `call.choiceIndex` to keep conversation branches separate.

Use SDK-decoded async iterables. Decode raw HTTP/SSE bytes before passing them to middleware.

- Invoker parses streamed JSON once, after `finish_reason: "tool_calls"`.
- Truncated or content-filtered calls fail with `INCOMPLETE_CALL` and never execute.
- Middleware forwards text and non-tool deltas immediately when pulled.
- Calls completed in one chunk run sequentially before middleware yields that chunk. Slow tools delay subsequent reads through backpressure.

See the [official OpenAI function calling guide](https://developers.openai.com/api/docs/guides/function-calling#streaming) for fragmented deltas and the next request's format.

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

Invoker executes calls at `response.output_item.done`, not again at `response.completed`. Tool results use `call_id`.

Send `outputs` with the previous response ID, or retain complete output items, including reasoning, in the next input. Azure supports compatible Chat Completions streams. Responses support depends on the provider and deployment.

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

Invoker executes complete JSON `functionCall` parts after the candidate's `finishReason: "STOP"`. Other finish reasons or missing completion markers fail pending calls with `INCOMPLETE_CALL`.

Calls without provider IDs receive local lifecycle IDs. Their `functionResponse` omits the synthetic ID and retains the function name. Preserve all model parts and signatures. For multiple candidates, use `call.choiceIndex` to keep history branches separate.

The adapter supports GenerateContent streams, including parallel complete function calls. Gemini Live events and Vertex `partialArgs`/`willContinue` argument streaming need separate adapters. Invoker rejects partial Vertex calls without executing them. See the [typed SDK example](examples/gemini.ts).

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

The adapter assembles client `tool_use` blocks by index. It joins `input_json_delta` fragments and dispatches at `content_block_stop`. If the message ends before a block closes, that call fails with `INCOMPLETE_CALL`. The adapter preserves thinking/signature deltas and server tools.

Result blocks match `tool_use_id` and set `is_error` for failures. Preserve the SDK's complete assistant content, including thinking and signatures. Send results in the next user message. See the [typed SDK example](examples/claude.ts).

These examples advertise registered tools only and perform one tool round. Your application sets round limits and must resolve unknown calls if any appear.

In production:

- Collect outcomes synchronously.
- Unsubscribe in `finally`.
- If you enable consumption, preserve full assistant content before middleware filters it.

## Pause and consume

Set `consume: true` to remove a tool's call fragments. The default is `false`.

| Protocol         | Consumption behavior                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat Completions | Copies mixed chunks only when filtering is necessary. Preserves text, unregistered calls, choice metadata, usage, and Azure filtering data. |
| Responses        | Suppresses function-call entries for consuming tools. Preserves response-wide completion metadata.                                          |
| Gemini           | Removes handled function-call parts. Preserves candidate metadata and unrelated parts.                                                      |
| Claude           | Suppresses handled client tool start/argument/stop events. Preserves message-wide events and other blocks.                                  |

Paused middleware forwards original entries without running tools or emitting tool lifecycle events. It skips calls whose fragments cross a pause, even if you resume before completion. The adapter cannot observe a pause/resume entirely between two pulls.

Unregistering stops dispatch and consumption of subsequent fragments. It allows handlers that already started to finish. Abort middleware to interrupt Effects. `invoke()` uses the function selected at its start throughout validation and execution.

Each `middleware()` iterator has isolated stream state. Invoker checks registration at dispatch time. Separate streams do not share or deduplicate executions. Replaying a stream can run its tools again.

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

`invoke()` is lazy and returns `Effect<ToolResult, ToolError, Requirements>`. Its typed error channel includes:

- Argument validation failures and enabled result validation failures.
- Thrown errors and rejected promises.
- Failed or defective Effects.
- Serialization failures.

Middleware settles tool failures and continues reading. Source, adapter, and custom-runner failures emit `onStreamError` and propagate to the consumer. Interrupted execution preserves Effect interruption and emits `CANCELLED` lifecycle events.

Declare services on the instance. Provide a typed runner:

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

A default `Invoker` rejects handlers with missing service requirements at compile time. Supply all instance requirements before executing `invoke()` directly.

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

Invoker calls observers synchronously when it emits an event. It observes returned promises for rejection but does not await them. Async observers can finish after iteration. Collect essential results synchronously.

Listener failures cannot break tools or other listeners. Failures in `onListenerError` listeners do not emit another `onListenerError`. TypeScript marks payloads read-only. Observers should not mutate them at runtime.

Successful calls emit events in this order:

1. `onBeforeArgValidation`
2. `onBeforeToolCall`
3. `onToolCallSuccess`
4. `onAfterToolCall`

Validation failures omit `onBeforeToolCall`. Middleware ignores unknown tools and disabled calls. Direct `invoke()` instead returns `NOT_REGISTERED` or `PAUSED` failures.

`ToolError` exposes `code`, `message`, and `detail`. The `detail` field contains the original exception or Zod validation error. Error codes are:

- `NOT_REGISTERED`, `PAUSED`
- `INVALID_JSON`, `INVALID_ARGUMENTS`, `INVALID_RESULT`
- `HANDLER_FAILED`, `SERIALIZATION_FAILED`
- `INCOMPLETE_CALL`, `ARGUMENT_LIMIT`, `CALL_LIMIT`
- `CANCELLED`

Failure `content` contains a success flag, code, and generic message. Original exception details stay local. Success `content` uses the JSON envelope described above. Circular values and BigInts fail serialization.

## Limits, cancellation, and adapters

```ts
const bounded = new Invoker({
  maxArgumentLength: 1_048_576, // default: UTF-16 code units per call
  maxPendingCalls: 128, // default: in-flight calls per stream
});

const controller = new AbortController();
const wrapped = bounded.middleware(stream, { signal: controller.signal });
```

Limits must be positive integers. They apply to streamed arguments, including unknown calls. Direct invocation accepts complete input.

- Exceeding the argument limit clears buffered arguments and reports an error at completion.
- Exceeding the pending-call limit fails tracked calls and stops buffering new calls for that stream. Middleware still forwards original entries.

Aborting interrupts active Effects and closes the source when iteration resumes. Effect-based HTTP operations can cooperate with interruption. Invoker cannot forcibly stop plain synchronous functions or promises that already started. To unblock a pending network read, also pass the signal to the SDK request.

Ending iteration early closes the underlying iterator. Incomplete calls never execute.

`invoker` exports all three adapter factories. For another protocol, implement a `StreamAdapter` that creates a session per stream:

- `push(entry, enabled, consume)` returns `{ entry, calls, consumed? }`: the forwarded entry, normalized **complete** `ToolCall`s, and an optional suppression flag.
- `finish()` reports incomplete pending calls through `call.error`.

A `ProviderAdapter<Tools, Result>` also implements `tools(schemas)` for declarations and `result(outcome)` to format results.

## Development

```sh
vp install
vp run check   # formatting, lint, TypeScript 6 + Svelte checks
vp test        # offline unit/stream tests
vp run build  # Vite+ Pack ESM build + declaration generation
vp pm pack    # npm tarball (runs prepack)
```

Type checks and declaration generation use TypeScript 6. Vite+ manages builds, tests, formatting, linting, and pnpm. Runtime tests and compile-only SDK/type contracts need no credentials or live API requests.

## Demo website

The [Svelte 5 + Tailwind 4 site](https://wingsmc.github.io/invoker/) runs the library with an internal mock AI service.

- SVG packets animate the tool-routing diagram.
- The playground shows streamed arguments, validation, results, and lifecycle events.
- Syntax-highlighted tabs show registration, SDK streaming, events, mock usage, provider examples, and result documentation.

The site needs no credentials or backend. It supports narrow screens and reduced motion, with no external font or AI requests.

Vite supplies the size badge through `import.meta.env.VITE_INVOKER_GZIP_KB`. The badge measures gzip bytes of `dist/index.js` in decimal KB, rounded to one decimal place. It covers the full ESM artifact, not the npm tarball. It excludes external peers, TypeScript declarations, and source maps.

Development and site build scripts build the library first, so the badge matches that build. Restart site development after library changes to refresh the measurement.

```sh
vp run dev           # local demo with hot reload (http://127.0.0.1:5173)
vp run site:check    # check Svelte and TypeScript
vp run site:build    # static site in site-dist/
vp run site:preview  # preview the production site
vp exec playwright install chromium
vp run test:e2e      # production-site browser checks (build the site first)
```

Unit tests and the website share `testing/mock-ai.ts`. The npm package excludes it. `MockAIService.stream()` scripts Chat Completions, Responses, Gemini, or Claude events with:

- Text, tool calls, and usage.
- Invalid arguments and truncation.
- Simulated network failures (`failAfter`) and abortable delays.

OpenAI and Claude formats test fragmented and interleaved JSON. Gemini emits complete function-call parts. Test defaults are deterministic, with zero latency. `site/demo.ts` connects these streams to registered Effect handlers. The UI scripts its second mock response from their actual outcomes.

The [GitHub Pages workflow](.github/workflows/pages.yml) checks pull requests, builds and deploys pushes to `main`, and supports manual dispatch. Pages uses `site-dist/`, separate from the library's `dist/`. Relative asset URLs support repository Pages paths and custom domains.

To deploy:

1. Set **Settings → Pages → Source** to **GitHub Actions** once.
2. Push to `main`.

The expected URL is https://wingsmc.github.io/invoker/.

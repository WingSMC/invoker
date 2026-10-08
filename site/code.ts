/** Lightweight lexical highlighting: escape first, never execute snippet text. */
export function escape(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

export function highlight(source: string): string {
  const pattern =
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\b(import|from|const|let|new|return|await|for|of|async|function|type|interface|export|readonly|true|false|void|if|throw)\b|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_$][\w$]*)(?=\s*\()/g;
  let result = "";
  let position = 0;
  for (const match of source.matchAll(pattern)) {
    result += escape(source.slice(position, match.index));
    const color = match[1]
      ? "text-syntax-comment"
      : match[2]
        ? "text-syntax-string"
        : match[3]
          ? "text-syntax-keyword"
          : match[4]
            ? "text-syntax-number"
            : "text-syntax-function";
    result += `<span class="${color}">${escape(match[0])}</span>`;
    position = match.index + match[0].length;
  }
  return result + escape(source.slice(position));
}

export const snippets = {
  register: `import { Invoker, argument } from "invoker";
import { Effect } from "effect";
import { z } from "zod";

const invoker = new Invoker();

invoker.register({
  name: "get_weather",
  description: "Get the weather for a city.",
  sideEffects: "Reads weather data. No writes.",
  returns: {
    schema: z.object({
      city: z.string(),
      unit: z.enum(["celsius", "fahrenheit"]),
      temperature: z.number(),
    }),
    description: "Temperature in the requested unit.",
    // Schema documents/types the result. No parsing by default.
    // Set validate: true for refinements or transforms.
  },
  args: [
    argument("city", z.string(), "City and country."),
    argument("unit", z.enum(["celsius", "fahrenheit"])
      .default("celsius"), "Temperature unit."),
  ],
  // Both arguments are inferred from your schemas.
  handler: (city, unit) => Effect.succeed({
    city, unit, temperature: 18,
  }),
  consume: false,
});`,
  stream: `// OpenAI or AzureOpenAI — same stream interface.
const stream = await client.chat.completions.create({
  model: "YOUR_MODEL_OR_DEPLOYMENT",
  messages: [{ role: "user", content: "Weather in Berlin?" }],
  tools: invoker.toTools(),
  stream: true,
});

for await (const chunk of invoker.middleware(stream)) {
  // Text, usage, and unknown tools pass through.
  renderChat(chunk);
}

// Or use OpenAI Responses.
const response = await client.responses.create({
  model: "YOUR_MODEL",
  input: "Weather in Berlin?",
  tools: invoker.toResponseTools(),
  stream: true,
});
for await (const event of invoker.middleware(response)) {
  renderResponse(event);
}`,
  events: `// Your UI observes every step. Each returns an unsubscribe.
invoker.onBeforeArgValidation(({ call }) => {
  showProgress(call.name, "Validating");
});

invoker.onBeforeToolCall(({ call, args }) => {
  showProgress(call.name, "Running", args);
});

invoker.onToolCallSuccess(({ call, value, content }) => {
  showResult(call.id, value);
  // Send content back to your model in its next request.
});

invoker.onToolCallFail(({ call, error }) => {
  showError(call.id, error.code);
});

invoker.pause();                  // Stream passes through.
invoker.resume();                 // Dispatch resumes.
invoker.unregister("get_weather"); // Runtime control.`,
  mock: `// Internal demo/test helper in this repository.
import { MockAIService } from "./testing/mock-ai";

// Zero latency by default. No credentials or network.
const mock = new MockAIService({
  delayMs: 200,      // 0.2 seconds between stream entries.
  fragmentSize: 7,   // Test fragmented JSON arguments.
});

const stream = mock.stream({
  protocol: "chat-completions", // responses, gemini, claude too.
  text: "Let me check the weather.",
  calls: [{
    name: "get_weather",
    arguments: { city: "Berlin, DE", unit: "celsius" },
  }],
});

for await (const chunk of invoker.middleware(stream)) {
  renderChat(chunk);
}

// Test failures too: invalid JSON, truncate, failAfter,
// interleaved calls, unknown tools, and AbortSignal.`,
} as const;

export const providerSnippets = {
  openai: `import { openAIAdapter } from "invoker";

// Use your registered invoker and SDK client.
const adapter = openAIAdapter(); // Azure uses this too.
const results = [];
const off = invoker.onAfterToolCall(outcome => {
  results.push(adapter.result(outcome));
});

const stream = await client.chat.completions.create({
  model, messages, stream: true,
  tools: invoker.toTools(adapter),
});
for await (const chunk of invoker.middleware(stream, { adapter })) {
  renderChat(chunk); // Preserve the complete assistant message.
}
off();

// Append that assistant message, then these tool messages.
messages.push(assistantMessage, ...results);
// Make the next request with the updated history.

// Responses: openAIAdapter({ protocol: "responses" })
// exports response tools + function_call_output results.`,
  gemini: `import { geminiAdapter } from "invoker";

const adapter = geminiAdapter();
const results = [];
const parts = [];
const off = invoker.onAfterToolCall(outcome => {
  results.push(adapter.result(outcome));
});

const stream = await ai.models.generateContentStream({
  model, contents,
  config: { tools: invoker.toTools(adapter), candidateCount: 1 },
});
for await (const chunk of invoker.middleware(stream, { adapter })) {
  // Keep all parts, including thoughtSignature and functionCall.
  parts.push(...(chunk.candidates?.[0]?.content?.parts ?? []));
  renderGemini(chunk);
}
off();

contents.push(
  { role: "model", parts },
  { role: "user", parts: results }, // functionResponse parts
);
// Make the next request with the updated contents.`,
  claude: `import { claudeAdapter } from "invoker";

const adapter = claudeAdapter();
const results = [];
const off = invoker.onAfterToolCall(outcome => {
  results.push(adapter.result(outcome));
});

const stream = client.messages.stream({
  model, messages, max_tokens: 1024,
  tools: invoker.toTools(adapter),
});
for await (const event of invoker.middleware(stream, { adapter })) {
  renderClaude(event); // Text, thinking, and server tools pass through.
}
off();
const assistant = await stream.finalMessage();

messages.push(
  { role: "assistant", content: assistant.content },
  { role: "user", content: results }, // tool_result blocks
);
// Make the next request with the updated messages.`,
} as const;

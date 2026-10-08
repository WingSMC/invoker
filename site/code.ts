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
  protocol: "chat-completions", // Or "responses".
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

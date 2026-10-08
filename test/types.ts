// Compile-only contract checks, including the SDK's actual stream and tool types.
import { Context, Effect } from "effect";
import type OpenAI from "openai";
import type { GenerateContentResponse, Tool as GeminiTool, Part } from "@google/genai";
import type {
  RawMessageStreamEvent,
  Tool as ClaudeTool,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import { Invoker, argument, geminiAdapter, claudeAdapter, openAIAdapter } from "../src/index.js";
import type { ToolError, ToolResult } from "../src/index.js";

const invoker = new Invoker();
const typed = invoker.register({
  name: "typed",
  description: "Typed parameters",
  sideEffects: "None.",
  returns: {
    schema: z.object({ inferredCount: z.number(), inferredLabel: z.string().optional() }),
    description: "The typed function result.",
  },
  args: [argument("count", z.number(), "Count"), argument("label", z.string().optional(), "Label")],
  handler: (count, label) => {
    const inferredCount: number = count;
    const inferredLabel: string | undefined = label;
    return { inferredCount, inferredLabel };
  },
});

invoker.register({
  name: "wrong",
  description: "Wrong type",
  sideEffects: "None.",
  returns: { schema: z.string(), description: "The wrong function result." },
  args: [argument("count", z.number(), "Count")],
  // @ts-expect-error Zod number output cannot feed a string parameter.
  handler: (count: string) => count,
});

invoker.register({
  name: "arity",
  description: "Wrong arity",
  sideEffects: "None.",
  returns: {
    schema: z.object({ count: z.number(), extra: z.boolean() }),
    description: "The arity function result.",
  },
  args: [argument("count", z.number(), "Count")],
  // @ts-expect-error The handler cannot require an undeclared second argument.
  handler: (count: number, extra: boolean) => ({ count, extra }),
});

const typedEffect: Effect.Effect<ToolResult, ToolError> = invoker.invoke({
  id: "t",
  name: "typed",
  arguments: "{}",
});
void typedEffect;
const typedResult: Effect.Effect<
  ToolResult<{ inferredCount: number; inferredLabel?: string | undefined }>,
  ToolError
> = typed.invoke({ id: "typed", arguments: {} });
void typedResult;
typed.onToolCallSuccess(({ value }) => {
  const count: number = value.inferredCount;
  // @ts-expect-error The typed registration preserves its result shape.
  const wrong: string = value.inferredCount;
  void count;
  void wrong;
});
const action = invoker.register({
  name: "void",
  description: "Void action.",
  sideEffects: "Updates the UI.",
  args: [],
  handler: () => {},
});
const voidResult: Effect.Effect<ToolResult<void>, ToolError> = action.invoke({
  id: "v",
  arguments: {},
});
void voidResult;
const transformed = invoker.register({
  name: "length",
  description: "Count characters.",
  sideEffects: "None.",
  args: [],
  returns: {
    schema: z.string().transform((value) => value.length),
    description: "Character count.",
    validate: true,
  },
  handler: () => "text",
});
const transformedResult: Effect.Effect<ToolResult<number>, ToolError> = transformed.invoke({
  id: "length",
  arguments: {},
});
void transformedResult;
invoker.register({
  name: "bad_return",
  description: "Bad return.",
  sideEffects: "None.",
  args: [],
  returns: { schema: z.number(), description: "Number." },
  // @ts-expect-error The result validator requires a number.
  handler: () => "wrong",
});
invoker.register({
  name: "untyped_return",
  description: "Missing contract.",
  sideEffects: "None.",
  args: [],
  // @ts-expect-error An omitted result contract defaults to void.
  handler: () => 42,
});

class Database extends Context.Service<Database, { lookup: (id: number) => string }>()(
  "Database",
) {}
const database = { lookup: (id: number) => String(id) };
const serviceInvoker = new Invoker<Database>({
  runEffect: (effect, signal) =>
    Effect.runPromise(
      effect.pipe(Effect.provideService(Database, database)),
      signal ? { signal } : undefined,
    ),
});
serviceInvoker.register({
  name: "lookup",
  description: "Look up a record",
  sideEffects: "None.",
  returns: { schema: z.string(), description: "The lookup function result." },
  args: [argument("id", z.number(), "Record ID")],
  handler: (id) =>
    Effect.gen(function* () {
      return (yield* Database).lookup(id);
    }),
});
const withRequirements: Effect.Effect<ToolResult, ToolError, Database> = serviceInvoker.invoke({
  id: "t",
  name: "lookup",
  arguments: "{}",
});
void withRequirements;

// @ts-expect-error A serviceful instance must supply a runner providing its requirements.
new Invoker<Database>();
const requiresDatabase = () =>
  Effect.gen(function* () {
    return yield* Database;
  });
invoker.register({
  name: "missing_service",
  description: "Needs an undeclared service",
  sideEffects: "None.",
  returns: { schema: z.unknown(), description: "The missing_service function result." },
  args: [],
  // @ts-expect-error A default Invoker can run only Effects without service requirements.
  handler: requiresDatabase,
});

const chatTools: OpenAI.Chat.Completions.ChatCompletionTool[] = invoker.toTools();
const responseTools: OpenAI.Responses.Tool[] = invoker.toResponseTools();
void chatTools;
void responseTools;
const gemini = geminiAdapter();
const claude = claudeAdapter();
const geminiTools: GeminiTool[] = invoker.toTools(gemini);
const claudeTools: ClaudeTool[] = invoker.toTools(claude);
declare const outcome: ToolResult;
const geminiOutput: Part = gemini.result(outcome);
const claudeOutput: ToolResultBlockParam = claude.result(outcome);
const chatOutput: OpenAI.Chat.Completions.ChatCompletionToolMessageParam =
  openAIAdapter().result(outcome);
const responseOutput: OpenAI.Responses.ResponseInputItem = openAIAdapter({
  protocol: "responses",
}).result(outcome);
void [geminiTools, claudeTools, geminiOutput, claudeOutput, chatOutput, responseOutput];
export function geminiCompatibility(
  source: AsyncIterable<GenerateContentResponse>,
): AsyncIterable<GenerateContentResponse> {
  return invoker.middleware(source, { adapter: gemini });
}
export function claudeCompatibility(
  source: AsyncIterable<RawMessageStreamEvent>,
): AsyncIterable<RawMessageStreamEvent> {
  return invoker.middleware(source, { adapter: claude });
}

export function chatCompatibility(
  source: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
) {
  const middleware: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> =
    invoker.middleware(source);
  return middleware;
}

export function responseCompatibility(source: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>) {
  const middleware: AsyncIterable<OpenAI.Responses.ResponseStreamEvent> =
    invoker.middleware(source);
  return middleware;
}

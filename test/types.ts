// Compile-only contract checks, including the SDK's actual stream and tool types.
import { Context, Effect } from "effect";
import type OpenAI from "openai";
import { z } from "zod";
import { Invoker, argument } from "../src/index.js";
import type { ToolError, ToolResult } from "../src/index.js";

const invoker = new Invoker();
invoker.register({
  name: "typed",
  description: "Typed parameters",
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
  args: [argument("count", z.number(), "Count")],
  // @ts-expect-error Zod number output cannot feed a string parameter.
  handler: (count: string) => count,
});

invoker.register({
  name: "arity",
  description: "Wrong arity",
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
  args: [],
  // @ts-expect-error A default Invoker can run only Effects without service requirements.
  handler: requiresDatabase,
});

const chatTools: OpenAI.Chat.Completions.ChatCompletionTool[] = invoker.toTools();
const responseTools: OpenAI.Responses.Tool[] = invoker.toResponseTools();
void chatTools;
void responseTools;

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

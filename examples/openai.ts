import OpenAI from "openai";
import { Effect } from "effect";
import { z } from "zod";
import { Invoker, argument } from "../src/index.js";
import type { ToolFailure, ToolResult } from "../src/index.js";

/** Run from your application with its API credentials and model/deployment. */
export async function chat(client: OpenAI, model: string): Promise<void> {
  const invoker = new Invoker();
  invoker.register({
    name: "add",
    description: "Add two numbers.",
    args: [
      argument("left", z.number(), "Left operand."),
      argument("right", z.number(), "Right operand."),
    ],
    handler: (left, right) => Effect.succeed(left + right),
  });

  const completed: (ToolResult | ToolFailure)[] = [];
  invoker.onAfterToolCall((event) => {
    completed.push(event);
  });
  invoker.onBeforeToolCall(({ call, args }) => console.log("Calling", call.name, args));

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "user", content: "What is 4 plus 7?" },
  ];
  const tools = invoker.toTools();
  const stream = await client.chat.completions.create({ model, messages, tools, stream: true });
  let content = "";
  for await (const chunk of invoker.middleware(stream)) {
    content += chunk.choices[0]?.delta.content ?? "";
  }
  if (!completed.length) {
    console.log(content);
    return;
  }

  messages.push({
    role: "assistant",
    content: content || null,
    tool_calls: completed.map(({ call }) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.name,
        arguments:
          typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments),
      },
    })),
  });
  messages.push(
    ...completed.map(({ call, content }) => ({
      role: "tool" as const,
      tool_call_id: call.id,
      content,
    })),
  );
  // This example performs one tool round. Applications can repeat with their own round limit.
  const answer = await client.chat.completions.create({ model, messages, tools });
  console.log(answer.choices[0]?.message.content);
}

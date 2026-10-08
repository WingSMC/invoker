import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { Invoker, claudeAdapter } from "../src/index.js";

/** One tool round; register tools on invoker before calling. Default consume: false. */
export async function claude(client: Anthropic, model: string, invoker: Invoker): Promise<void> {
  const adapter = claudeAdapter();
  const results: ToolResultBlockParam[] = [];
  const off = invoker.onAfterToolCall((outcome) => {
    results.push(adapter.result(outcome));
  });
  const messages: MessageParam[] = [{ role: "user", content: "What's the weather in Berlin?" }];
  const tools = invoker.toTools(adapter);
  const stream = client.messages.stream({ model, messages, tools, max_tokens: 1024 });
  try {
    for await (const event of invoker.middleware(stream, { adapter })) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        process.stdout.write(event.delta.text);
      }
    }
  } finally {
    off();
  }
  const assistant = await stream.finalMessage();
  if (!results.length) return;
  // Keep text, thinking, signatures, and tool_use blocks from the SDK collector.
  messages.push(
    { role: "assistant", content: assistant.content },
    { role: "user", content: results },
  );
  const answer = await client.messages.create({ model, messages, tools, max_tokens: 1024 });
  for (const block of answer.content) if (block.type === "text") console.log(block.text);
}

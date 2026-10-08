import { GoogleGenAI } from "@google/genai";
import type { Content, Part } from "@google/genai";
import { Invoker, geminiAdapter } from "../src/index.js";

/** One tool round; register tools on invoker before calling. Default consume: false. */
export async function gemini(ai: GoogleGenAI, model: string, invoker: Invoker): Promise<void> {
  const adapter = geminiAdapter();
  const results: Part[] = [];
  const parts: Part[] = [];
  const off = invoker.onAfterToolCall((outcome) => {
    results.push(adapter.result(outcome));
  });
  const contents: Content[] = [
    { role: "user", parts: [{ text: "What's the weather in Berlin?" }] },
  ];
  const config = { tools: invoker.toTools(adapter), candidateCount: 1 };
  try {
    const stream = await ai.models.generateContentStream({ model, contents, config });
    for await (const chunk of invoker.middleware(stream, { adapter })) {
      // Preserve full parts, including thought signatures and tool calls.
      parts.push(...(chunk.candidates?.[0]?.content?.parts ?? []));
    }
  } finally {
    off();
  }
  if (!results.length) return;
  // This example advertises registered tools only; route unknown tools separately.
  contents.push({ role: "model", parts }, { role: "user", parts: results });
  const answer = await ai.models.generateContent({ model, contents, config });
  console.log(answer.text);
}

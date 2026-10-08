import type { AdapterOptions, ProviderAdapter, ToolCall } from "../types.js";
import { ToolError } from "../errors.js";
import { CallBuffer, limits, record, text } from "./shared.js";

export interface GeminiTool {
  readonly functionDeclarations: {
    readonly name: string;
    readonly description: string;
    readonly parametersJsonSchema: Record<string, unknown>;
    readonly responseJsonSchema?: Record<string, unknown>;
  }[];
}
export interface GeminiResult {
  readonly functionResponse: {
    readonly name: string;
    readonly id?: string;
    readonly response: Record<string, unknown>;
  };
}

/** Gemini generateContentStream chunks with complete JSON functionCall parts. */
export function geminiAdapter(
  options: AdapterOptions = {},
): ProviderAdapter<GeminiTool[], GeminiResult> {
  limits(options);
  return {
    tools: (schemas) => [
      {
        functionDeclarations: schemas.map(({ name, description, parameters, resultSchema }) => ({
          name,
          description,
          parametersJsonSchema: structuredClone(parameters),
          ...(resultSchema ? { responseJsonSchema: structuredClone(resultSchema) } : {}),
        })),
      },
    ],
    result: (outcome) => ({
      functionResponse: {
        name: outcome.call.name,
        ...(outcome.call.providerCallId === false ? {} : { id: outcome.call.id }),
        response: JSON.parse(outcome.content) as Record<string, unknown>,
      },
    }),
    create() {
      const buffer = new CallBuffer(options);
      let sequence = 0;
      return {
        push(entry, enabled, consume) {
          if (!enabled) buffer.pause();
          const event = record(entry);
          if (!Array.isArray(event?.candidates)) return { entry, calls: [] };
          const calls: ToolCall[] = [];
          let changed = false;
          const candidates = event.candidates.map((value, position) => {
            const candidate = record(value);
            const content = record(candidate?.content);
            const index = typeof candidate?.index === "number" ? candidate.index : position;
            const parts = Array.isArray(content?.parts) ? content.parts : [];
            const visible: unknown[] = [];
            for (const part of parts) {
              const fn = record(record(part)?.functionCall);
              if (!fn) {
                visible.push(part);
                continue;
              }
              const id = text(fn.id);
              const key = `${index}:${id || ++sequence}`;
              const item = buffer.add(
                key,
                {
                  id: id || `gemini_${sequence}`,
                  providerCallId: !!id,
                  name: text(fn.name),
                  arguments: {},
                  protocol: "gemini",
                  choiceIndex: index,
                },
                enabled,
              );
              if (!item) {
                visible.push(part);
                continue;
              }
              // Vertex partial argument events require a separate assembler; never execute partial input.
              if (fn.partialArgs || fn.willContinue === true)
                item.error = new ToolError(
                  "INCOMPLETE_CALL",
                  "Partial Vertex function arguments are not supported by this adapter",
                );
              buffer.append(item, JSON.stringify(fn.args ?? {}));
              if (!(enabled && consume(item.call.name))) visible.push(part);
            }
            if (candidate?.finishReason) {
              for (const [key, item] of buffer.pending) {
                if (item.call.choiceIndex !== index) continue;
                const call = buffer.complete(key, candidate.finishReason !== "STOP");
                if (call) calls.push(call);
              }
            }
            if (visible.length === parts.length) return value;
            changed = true;
            return { ...candidate, content: { ...content, parts: visible } };
          });
          return { entry: changed ? { ...event, candidates } : entry, calls };
        },
        finish: () => buffer.finish(),
      };
    },
  };
}

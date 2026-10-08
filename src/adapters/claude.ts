import type { AdapterOptions, ProviderAdapter, ToolCall } from "../types.js";
import { CallBuffer, limits, record, text } from "./shared.js";

export interface ClaudeTool {
  readonly name: string;
  readonly description: string;
  readonly input_schema: { type: "object"; [key: string]: unknown };
}
export interface ClaudeResult {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  readonly content: string;
  readonly is_error: boolean;
}

/** Claude Messages raw events. Built-in/server tools remain untouched. */
export function claudeAdapter(
  options: AdapterOptions = {},
): ProviderAdapter<ClaudeTool[], ClaudeResult> {
  limits(options);
  return {
    tools: (schemas) =>
      schemas.map(({ name, description, parameters }) => ({
        name,
        description,
        input_schema: { ...structuredClone(parameters), type: "object" },
      })),
    result: (outcome) => ({
      type: "tool_result",
      tool_use_id: outcome.call.id,
      content: outcome.content,
      is_error: "error" in outcome,
    }),
    create() {
      const buffer = new CallBuffer(options);
      return {
        push(entry, enabled, consume) {
          if (!enabled) buffer.pause();
          const event = record(entry);
          if (!event) return { entry, calls: [] };
          const calls: ToolCall[] = [];
          let consumed = false;
          const key = String(event.index);
          if (event.type === "content_block_start") {
            const block = record(event.content_block);
            if (block?.type === "tool_use" && typeof event.index === "number") {
              const item = buffer.add(
                key,
                {
                  id: text(block.id),
                  name: text(block.name),
                  arguments: record(block.input) ?? {},
                  protocol: "claude",
                  toolIndex: event.index,
                },
                enabled,
              );
              consumed = !!item && enabled && consume(item.call.name);
            }
          } else if (event.type === "content_block_delta") {
            const item = buffer.pending.get(key);
            const delta = record(event.delta);
            if (item) {
              item.enabled &&= enabled;
              if (delta?.type === "input_json_delta") {
                buffer.append(item, text(delta.partial_json));
                consumed = enabled && consume(item.call.name);
              }
            }
          } else if (event.type === "content_block_stop") {
            const item = buffer.pending.get(key);
            consumed = !!item && enabled && consume(item.call.name);
            const call = buffer.complete(key);
            if (call) calls.push(call);
          } else if (
            event.type === "message_delta" ||
            event.type === "message_stop" ||
            event.type === "error"
          )
            calls.push(...buffer.finish());
          return { entry, calls, consumed };
        },
        finish: () => buffer.finish(),
      };
    },
  };
}

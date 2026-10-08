import { ToolError } from "../errors.js";
import type { AdapterOptions, ToolCall } from "../types.js";

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function limits(options: AdapterOptions) {
  function positive(value: number | undefined, fallback: number, name: string) {
    const result = value ?? fallback;
    if (!Number.isSafeInteger(result) || result < 1)
      throw new RangeError(`${name} must be a positive integer`);
    return result;
  }
  return {
    length: positive(options.maxArgumentLength, 1_048_576, "maxArgumentLength"),
    calls: positive(options.maxPendingCalls, 128, "maxPendingCalls"),
  };
}

export interface PendingCall {
  call: ToolCall;
  enabled: boolean;
  fragments: string[];
  length: number;
  error?: ToolError;
}

/** Bounded argument state for provider sessions. */
export class CallBuffer {
  readonly pending = new Map<string, PendingCall>();
  readonly #limits;
  #exhausted = false;
  constructor(options: AdapterOptions) {
    this.#limits = limits(options);
  }
  pause() {
    for (const item of this.pending.values()) {
      item.enabled = false;
      item.fragments = [];
    }
  }
  add(key: string, call: ToolCall, enabled: boolean) {
    if (this.#exhausted) return undefined;
    const existing = this.pending.get(key);
    if (existing) {
      existing.enabled &&= enabled;
      // A repeated start cannot reset pause, limits, or incomplete-call errors.
      existing.error ??= new ToolError("INCOMPLETE_CALL", "Duplicate pending tool-call identifier");
      existing.fragments = [];
      return existing;
    }
    if (this.pending.size >= this.#limits.calls) {
      this.#exhausted = true;
      for (const item of this.pending.values()) {
        item.error = new ToolError("CALL_LIMIT", "Stream exceeded the pending tool-call limit");
        item.fragments = [];
      }
      return undefined;
    }
    const item: PendingCall = { call, enabled, fragments: [], length: 0 };
    this.pending.set(key, item);
    return item;
  }
  append(item: PendingCall, fragment: string) {
    if (!item.enabled || item.error || !fragment) return;
    item.length += fragment.length;
    if (item.length > this.#limits.length) {
      item.error = new ToolError(
        "ARGUMENT_LIMIT",
        "Tool arguments exceeded the configured length limit",
      );
      item.fragments = [];
    } else item.fragments.push(fragment);
  }
  complete(key: string, interrupted = false) {
    const item = this.pending.get(key);
    if (!item) return undefined;
    this.pending.delete(key);
    if (!item.enabled) return undefined;
    const error =
      item.error ??
      (interrupted || !item.call.id || !item.call.name
        ? new ToolError("INCOMPLETE_CALL", "Stream ended before the tool call completed")
        : undefined);
    return {
      ...item.call,
      arguments: item.fragments.length ? item.fragments.join("") : item.call.arguments,
      ...(error ? { error } : {}),
    };
  }
  finish() {
    const calls: ToolCall[] = [];
    for (const key of this.pending.keys()) {
      const call = this.complete(key, true);
      if (call) calls.push(call);
    }
    return calls;
  }
}

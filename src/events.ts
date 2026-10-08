import type { Listener, ToolEvents } from "./types.js";

/** Observers cannot interrupt execution; rejected async listeners are also isolated. */
export class Events {
  readonly #listeners = new Map<keyof ToolEvents, Set<Listener<never>>>();

  on<Key extends keyof ToolEvents>(key: Key, listener: Listener<ToolEvents[Key]>): () => void {
    let listeners = this.#listeners.get(key);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(key, listeners);
    }
    const erased = listener as Listener<never>;
    listeners.add(erased);
    return () => {
      listeners.delete(erased);
      if (listeners.size === 0 && this.#listeners.get(key) === listeners)
        this.#listeners.delete(key);
    };
  }

  emit<Key extends keyof ToolEvents>(key: Key, event: ToolEvents[Key]): void {
    const listeners = this.#listeners.get(key);
    if (!listeners) return;
    // Snapshot so subscriptions changed by an observer apply to the next event.
    const snapshot = [...listeners];
    for (const listener of snapshot) {
      try {
        const result = listener(event as never);
        if (result) void Promise.resolve(result).catch((error: unknown) => this.#error(key, error));
      } catch (error) {
        this.#error(key, error);
      }
    }
  }

  #error(event: keyof ToolEvents, error: unknown): void {
    if (event !== "onListenerError") this.emit("onListenerError", { event, error });
  }
}

import { describe, expect, it } from "vite-plus/test";
import { DemoSession } from "../site/demo.js";
import type { DemoUpdate } from "../site/demo.js";
import { escape, highlight } from "../site/code.js";

function setup() {
  const events: DemoUpdate[] = [];
  const session = new DemoSession(
    (event) => {
      events.push(event);
    },
    { delayMs: 0, handlerDelayMs: 0, validationDelayMs: 0 },
  );
  return { session, events };
}

describe("shared demo model", () => {
  it.each(["chat-completions", "responses", "gemini", "claude"] as const)(
    "renders actual successful tool results in %s",
    async (protocol) => {
      const { session, events } = setup();
      const summary = await session.run({ scenario: "weather", city: "Berlin, DE", protocol });
      expect(summary.answer).toBe("Berlin, DE: 18°C, clear skies.");
      expect(summary.outcomes).toHaveLength(1);
      expect(summary.incoming).toBe(summary.forwarded);
      expect(events.filter((event) => event.type === "event").map((event) => event.label)).toEqual([
        "onBeforeArgValidation",
        "onBeforeToolCall",
        "onToolCallSuccess",
        "onAfterToolCall",
      ]);
      expect(
        events
          .filter((event) => event.type === "text")
          .map((event) => event.data)
          .join(""),
      ).toBe(summary.answer);
    },
  );

  it("consumes weather calls while preserving text and completion metadata", async () => {
    const { session } = setup();
    session.setConsume(true);
    const summary = await session.run({
      scenario: "weather",
      city: "Paris",
      protocol: "chat-completions",
    });
    expect(summary.incoming).toBeGreaterThan(summary.forwarded);
    expect(summary.outcomes).toHaveLength(1);
  });

  it.each(["invalid", "failure", "truncated"] as const)(
    "contains the %s scenario",
    async (scenario) => {
      const { session } = setup();
      const summary = await session.run({ scenario, city: "Berlin", protocol: "chat-completions" });
      const outcome = summary.outcomes[0];
      expect(outcome && "error" in outcome).toBe(true);
      expect(summary.answer).toContain("failure was contained");
    },
  );

  it("ignores unknown tools and supports live pause/unregistration", async () => {
    const { session, events } = setup();
    const request = { scenario: "weather", city: "Berlin", protocol: "chat-completions" } as const;
    session.setPaused(true);
    expect((await session.run(request)).outcomes).toHaveLength(0);
    session.setPaused(false);
    session.setRegistered(false);
    expect((await session.run(request)).outcomes).toHaveLength(0);
    session.setRegistered(true);
    expect((await session.run({ ...request, scenario: "unknown" })).outcomes).toHaveLength(0);
    expect(events.some((event) => event.type === "event")).toBe(false);
    expect((await session.run(request)).outcomes).toHaveLength(1);
  });

  it("runs two real handlers for the parallel scenario", async () => {
    const { session } = setup();
    const summary = await session.run({
      scenario: "parallel",
      city: "Paris",
      protocol: "responses",
    });
    expect(summary.outcomes).toHaveLength(2);
    expect(summary.answer).toContain("Paris: 18°C");
    expect(summary.answer).toContain("Tokyo, JP: 18°C");
  });

  it("escapes code and user data before syntax highlighting", () => {
    expect(escape("<script>\"&'</script>")).toBe("&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;");
    const output = highlight('const city = "<img src=x onerror=alert(1)>"; // safe');
    expect(output).toContain('class="text-syntax-keyword">const');
    expect(output).toContain('class="text-syntax-string"');
    expect(output).not.toContain("<img");
    expect(output).toContain("&lt;img");
  });
});

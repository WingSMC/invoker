import { Context, Effect } from "effect";
import { expect, it } from "vite-plus/test";
import { z } from "zod";
import { Invoker, argument } from "../src/index.js";

it("preserves Effect service requirements and provides them through a typed stream runner", async () => {
  class Database extends Context.Service<Database, { lookup: (id: number) => string }>()(
    "TestDatabase",
  ) {}
  const invoker = new Invoker<Database>({
    runEffect: (effect, signal) =>
      Effect.runPromise(
        effect.pipe(Effect.provideService(Database, { lookup: (id) => `record:${id}` })),
        signal ? { signal } : undefined,
      ),
  });
  invoker.register({
    name: "lookup",
    description: "Look up a record",
    args: [argument("id", z.number(), "Record ID")],
    handler: (id) =>
      Effect.gen(function* () {
        return (yield* Database).lookup(id);
      }),
  });
  const results: unknown[] = [];
  invoker.onToolCallSuccess(({ value }) => {
    results.push(value);
  });
  async function* source() {
    yield {
      id: "s",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "c",
                type: "function",
                function: { name: "lookup", arguments: '{"id":4}' },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };
    yield { id: "s", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] };
  }
  for await (const _entry of invoker.middleware(source())) {
    /* consume */
  }
  expect(results).toEqual(["record:4"]);
});

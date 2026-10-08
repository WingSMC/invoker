import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

async function run(page: Page) {
  await page.getByRole("button", { name: "Run demo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Run demo", exact: true })).toBeVisible({
    timeout: 40_000,
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("runs real weather middleware, renders highlighted code, and has no page errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Your AI thinks.");
  const size = (
    gzipSync(readFileSync(new URL("../dist/index.js", import.meta.url))).byteLength / 1000
  ).toFixed(1);
  await expect(page.getByTestId("build-size")).toContainText(`${size} KB`);
  await run(page);
  await expect(page.getByTestId("answer")).toContainText("Berlin, DE: 18°C");
  await expect(page.getByTestId("tool-output")).toContainText('"temperature": 18');
  await expect(page.getByTestId("events-count")).toHaveText("04");
  await expect(page.getByRole("tabpanel", { name: "Lifecycle events" })).toContainText(
    "onToolCallSuccess",
  );
  await expect(page.locator("#snippet code span").first()).toHaveCSS("color", "rgb(197, 162, 229)");
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test("demonstrates validation failures and unknown tool passthrough", async ({ page }) => {
  await page.getByRole("button", { name: "Invalid args", exact: true }).click();
  await run(page);
  await expect(page.getByTestId("tool-output")).toContainText("INVALID_ARGUMENTS");
  await page.getByRole("button", { name: "Unknown tool", exact: true }).click();
  await run(page);
  await expect(page.getByTestId("answer")).toContainText("search_web is not registered");
  await expect(page.getByTestId("events-count")).toHaveText("00");
});

test("pause, registration, and consume controls affect actual routing", async ({ page }) => {
  await page.getByRole("button", { name: "Pause middleware" }).click();
  await run(page);
  await expect(page.getByTestId("answer")).toContainText("Middleware is paused");
  await page.getByRole("button", { name: "Resume middleware" }).click();
  await page.getByText("Tool registered", { exact: true }).click();
  await run(page);
  await expect(page.getByTestId("events-count")).toHaveText("00");
  await page.getByText("Tool registered", { exact: true }).click();
  await page.getByText("Consume calls", { exact: true }).click();
  await run(page);
  expect(Number(await page.getByTestId("incoming-count").textContent())).toBeGreaterThan(
    Number(await page.getByTestId("forwarded-count").textContent()),
  );
  await expect(page.getByTestId("events-count")).toHaveText("04");
});

test("Responses executes two calls and code tabs support keyboard navigation", async ({ page }) => {
  await page.getByLabel("Mock AI protocol").selectOption("responses");
  await page.getByRole("button", { name: "Two calls", exact: true }).click();
  await run(page);
  await expect(page.getByTestId("answer")).toContainText("Tokyo, JP: 18°C");
  await expect(page.getByTestId("events-count")).toHaveText("08");
  const tabs = page.getByRole("tablist", { name: "Code examples" });
  await tabs.getByRole("tab", { name: "Register", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Stream", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("#snippet")).toContainText("invoker.middleware");
  await tabs.getByRole("tab", { name: "Mock AI", exact: true }).click();
  await expect(page.locator("#snippet")).toContainText("./testing/mock-ai");
  await expect(page.locator("#snippet")).not.toContainText("invoker/mock");
});

test("serves from a GitHub Pages repository subpath", async ({ page }) => {
  await page.route("**/invoker/**", async (route) => {
    const url = new URL(route.request().url());
    url.pathname = url.pathname.replace(/^\/invoker/, "");
    await route.fulfill({ response: await route.fetch({ url: url.toString() }) });
  });
  await page.goto("/invoker/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("invoker acts.");
  await run(page);
  await expect(page.getByTestId("answer")).toContainText("18°C");
});

for (const protocol of ["gemini", "claude"] as const) {
  test(`${protocol} routes calls and documents provider results`, async ({ page }) => {
    await page.getByLabel("Mock AI protocol").selectOption(protocol);
    await run(page);
    await expect(page.getByTestId("tool-output")).toContainText('"temperature": 18');
    await expect(page.getByTestId("events-count")).toHaveText("04");
    const tabs = page.getByRole("tablist", { name: "Provider examples" });
    await tabs
      .getByRole("tab", { name: protocol === "gemini" ? "Gemini" : "Claude", exact: true })
      .click();
    await expect(page.locator("#adapter-snippet")).toContainText(`${protocol}Adapter`);
    await expect(page.locator("#adapter-snippet")).toContainText("adapter.result(outcome)");
    await expect(page.locator("#adapter-snippet code span").first()).toHaveCSS(
      "color",
      "rgb(197, 162, 229)",
    );
    await page.keyboard.press("Home");
    await expect(tabs.getByRole("tab", { name: "OpenAI / Azure", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
}

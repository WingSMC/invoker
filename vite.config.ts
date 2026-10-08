import { defineConfig } from "vite-plus";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

export default defineConfig(({ mode }) => ({
  ...(mode === "site"
    ? {
        root: "site",
        plugins: [svelte({ configFile: "../svelte.config.js" }), tailwindcss()],
        base: "./",
        define: {
          "import.meta.env.VITE_INVOKER_GZIP_KB": JSON.stringify(
            (
              gzipSync(readFileSync(new URL("./dist/index.js", import.meta.url))).byteLength / 1000
            ).toFixed(1),
          ),
        },
        build: { outDir: "../site-dist", emptyOutDir: true, target: "es2022" },
        server: { host: "127.0.0.1" },
        preview: { host: "127.0.0.1" },
      }
    : {}),
  pack: {
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      // Remove to preserve subpath imports as written (the new default).
      // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
      resolveDepSubpath: true,
    },
    exports: true,
    entry: ["src/index.ts"],
    tsconfig: "tsconfig.build.json",
    format: ["esm"],
    platform: "neutral",
    target: "es2022",
    sourcemap: true,
    dts: true,
  },
  lint: {
    ignorePatterns: ["dist/**", "site-dist/**", ".package-smoke/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: { ignorePatterns: ["site-dist/**", ".package-smoke/**"] },
  test: { include: ["test/**/*.test.ts"] },
}));

import { defineConfig } from "vite-plus";

export default defineConfig({
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
    dts: {
      generator: "tsgo",
    },
  },
  lint: {
    ignorePatterns: ["dist/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});

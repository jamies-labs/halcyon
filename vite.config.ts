import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const reviewManifest = readFileSync(
  new URL("./ui-review.json", import.meta.url),
);

export default defineConfig({
  build: { target: "es2022" },
  plugins: [
    {
      name: "emit-ui-review-manifest",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "ui-review.json",
          source: reviewManifest,
        });
      },
    },
  ],
  // keelen's preview lane injects $PORT; local dev keeps vite's default.
  server: { port: Number(process.env.PORT) || 5173, host: true },
  test: { include: ["tests/unit/**/*.test.ts"] },
});

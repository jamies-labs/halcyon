import { defineConfig } from 'vitest/config';
export default defineConfig({
  build: { target: 'es2022' },
  // keelen's preview lane injects $PORT; local dev keeps vite's default.
  server: { port: Number(process.env.PORT) || 5173, host: true },
  test: { include: ['tests/unit/**/*.test.ts'] },
});

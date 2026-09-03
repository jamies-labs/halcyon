# HALCYON Implementation Plan

> **Historical planning artifact (2026-08-25).** This document preserves the
> original build plan, including superseded local paths, repository names,
> deadlines, and the planned Cloudflare deployment. HALCYON shipped from
> https://github.com/jamies-labs/halcyon and is live on Vercel at
> https://halcyon-opal.vercel.app/. See the root README for current setup and
> testing instructions.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship HALCYON — a WebMCP co-op puzzle game (human + agent crew a damaged starship) — live on Cloudflare Pages with a public MIT repo, in time for the OpenAI WebMCP Challenge deadline (2026-09-03 ~5 p.m. PT).

**Architecture:** Client-only SPA. A typed WebMCP layer (`shim` → `registry`) registers per-chapter tool sets against `document.modelContext`; six chapter modules each own a small state machine, an SVG scene, and their tool definitions; a flight-recorder panel logs every tool call and doubles as the dev/CI agent simulator. No backend.

**Tech Stack:** Vite + TypeScript (strict, no framework), Vitest (unit), Playwright (e2e), WebAudio (synthesized sound, no assets), GitHub Actions (CI), Cloudflare Pages via wrangler (deploy).

## Global Constraints

- Repo: `C:\Users\jamie\Documents\halcyon`, GitHub `jamie7893/halcyon`, public, MIT license at root. Spec: `docs/superpowers/specs/2026-08-25-halcyon-webmcp-game-design.md`.
- **Verification protocol (owner's global rule — tests run in CI, never locally):** each task = one branch + one PR. Commit the failing test FIRST (test-only commit proves red in history), then the implementation. Push, open PR, verify with `gh pr checks <PR#> --watch --interval 20`; on failure read `gh run view <run-id> --log-failed`. Merge with `gh pr merge <PR#> --squash --delete-branch` only on green. Locally permitted: `npx tsc --noEmit` and `npx prettier --check .` only.
- All WebMCP access goes through `src/webmcp/shim.ts`. No other file touches `document.modelContext`.
- Every write tool validates args against its `inputSchema` and returns structured outcomes: `{ok:true,data}` or `{ok:false,code,detail,hint,retry_after_ms?}`. Read-only tools set `readOnly: true` (→ `annotations.readOnlyHint`).
- Test-speed contract: all gameplay durations come from `src/game/timings.ts`; `?fast=1` shortens them. E2E always uses `?fast=1&sim=1&ch=N`.
- `window.halcyonSim = {invoke, listTools, getState, goto}` is a permanent, documented feature (simulator + e2e hook), not a test-only shim.
- Copy/tone: HALCYON is calm, dry, warm; never menacing. Failure never punishes; errors coach.
- No new npm runtime dependencies without a note in the PR body (target: zero runtime deps; dev deps only).
- Commit trailer on every commit: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## Owner preflight (Jamie — do these once, any time before the task that needs them)

1. **Task 1 needs `workflow` scope:** the gh token on this box has `repo` only (known trap: pushes containing `.github/workflows/*` are rejected). Run `gh auth refresh -h github.com -s repo,workflow` and complete the browser flow.
2. **Task 14 needs Cloudflare:** create/log into a Cloudflare account; create an API token (template "Edit Cloudflare Workers"/Pages Edit) and note the Account ID. Provide both when Task 14 starts.
3. **Devpost registration** at https://webmcp.devpost.com/ (any time; confirm the exact deadline hour in the official rules).
4. **Task 14/15 validation:** ChatGPT desktop app updated to the latest version, signed into your paid account.

## File map (final state)

```
halcyon/
  index.html                      app shell (#app root, loads /src/main.ts)
  package.json / package-lock.json / tsconfig.json / vite.config.ts
  playwright.config.ts / .gitignore / LICENSE / README.md
  .github/workflows/ci.yml        typecheck → unit → build → e2e
  src/
    main.ts                       compose store/registry/ui, chapter router, halcyonSim
    styles.css                    CRT/emergency theme
    webmcp/types.ts               ToolDef/ToolOutcome/InvokeRecord/ChapterId
    webmcp/validate.ts            minimal JSON-schema subset validator
    webmcp/shim.ts                detectModelContext(): host adapter (both API variants)
    webmcp/registry.ts            ToolRegistry: diff register/unregister, validate, rate-limit, log
    game/store.ts                 ShipState store + pub/sub
    game/timings.ts               T durations, FAST flag
    game/save.ts                  localStorage persistence (chapter, chapterDone)
    game/globalTools.ts           get_ship_state / broadcast / read_boot_briefing
    game/chapters/types.ts        Chapter + ChapterCtx interfaces
    game/chapters/ch1_contact.ts … ch6_burn.ts
    ui/dom.ts                     el()/svgEl() helpers
    ui/speaker.ts                 speaker panel (typewriter, aria-live)
    ui/recorder.ts                flight recorder + manual invoke form + timeline
    ui/gate.ts                    detection/setup screen + start + simulator toggle
    ui/chapterSelect.ts           chapter menu + prerequisite seeding
    audio/engine.ts               WebAudio synth (static, metronome, blips)
  tests/unit/validate.test.ts / registry.test.ts / store.test.ts
  tests/e2e/smoke.spec.ts / ch1.spec.ts … ch6.spec.ts / fullrun.spec.ts
```

Interfaces referenced by many tasks (defined in Task 2/3/4, consumed everywhere):

```ts
// webmcp/types.ts (Task 2)
export type ChapterId = 1 | 2 | 3 | 4 | 5 | 6;
export type ToolOutcome =
  | { ok: true; data: unknown }
  | { ok: false; code: string; detail: string; hint: string; retry_after_ms?: number };
export interface ToolDef {
  name: string; description: string; inputSchema: Record<string, unknown>;
  readOnly?: boolean; rateLimitMs?: number;
  execute(args: Record<string, unknown>): ToolOutcome | Promise<ToolOutcome>;
}
export interface InvokeRecord {
  seq: number; t: number; tool: string; args: unknown;
  outcome: ToolOutcome; ms: number; source: 'agent' | 'sim';
}

// webmcp/registry.ts (Task 3)
export class ToolRegistry {
  constructor(host: ModelContextHost | null, onRecord: (r: InvokeRecord) => void);
  listTools(): ToolDef[];
  setTools(defs: ToolDef[]): void;    // full desired set; diffs by name
  addTools(defs: ToolDef[]): void;    // merge into live set (mid-chapter registration)
  invoke(name: string, args: unknown, source?: 'agent' | 'sim'): Promise<InvokeRecord>;
}

// game/store.ts (Task 4)
export type Subsystem = 'life_support' | 'comms' | 'drive' | 'sensors' | 'lights' | 'heaters';
export interface ShipState {
  chapter: ChapterId; booted: boolean;
  chapterDone: Record<ChapterId, boolean>;
  power: Record<Subsystem, number>;
  flags: Record<string, unknown>;
}
export class Store {
  get(): ShipState;
  update(mut: (s: ShipState) => void): void;
  subscribe(fn: (s: ShipState) => void): () => void;
}

// game/chapters/types.ts (Task 5)
export interface ChapterCtx {
  store: Store; registry: ToolRegistry; audio: AudioEngine;
  speaker: Speaker; recorder: Recorder; stage: HTMLElement;
  complete(): void;
}
export interface Chapter {
  id: ChapterId; title: string;
  tools(ctx: ChapterCtx): ToolDef[];  // registered by the router on entry
  mount(ctx: ChapterCtx): void;       // build scene, wire human inputs
  unmount(): void;                    // remove listeners/timers
}
```

---

### Task 1: Scaffold, CI, repo

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `index.html`, `src/main.ts` (stub), `src/styles.css` (minimal), `.gitignore`, `LICENSE`, `README.md` (stub), `.github/workflows/ci.yml`, `tests/e2e/smoke.spec.ts`, `tests/unit/placeholder.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the build/test/CI substrate every later task pushes through; `#app` root div; npm scripts `dev|build|preview|typecheck|test:unit|test:e2e`.

- [ ] **Step 1: Owner gate** — confirm the owner ran `gh auth refresh -h github.com -s repo,workflow` (ask; do not proceed to push without it).

- [ ] **Step 2: Write config files**

`package.json`:
```json
{
  "name": "halcyon",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --port 4173 --strictPort",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run",
    "test:e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.55.0",
    "typescript": "^5.6.0",
    "vite": "^7.0.0",
    "vitest": "^3.2.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests/unit"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
export default defineConfig({ build: { target: 'es2022' } });
```

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'npm run preview',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HALCYON — a rescue for two crew</title>
    <meta name="description" content="A co-op puzzle game for you and your agent, built on WebMCP. Neither of you can save the ship alone." />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts` (stub for this task only; replaced in Task 5):
```ts
import './styles.css';
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<main class="shell"><h1>ISV HALCYON</h1><p data-testid="boot-note">Systems offline. Build in progress.</p></main>`;
```

`src/styles.css` (minimal; Task 13 expands):
```css
:root { --bg:#050807; --fg:#9ef0b6; --dim:#3a5f46; --warn:#f0b46a; --err:#f06a6a; --panel:#0a120d; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font-family:'Cascadia Mono','SF Mono',Consolas,monospace; }
.shell { max-width:1080px; margin:0 auto; padding:24px; }
```

`.gitignore`:
```
node_modules/
dist/
test-results/
playwright-report/
.env
```

`LICENSE`: the standard MIT text, `Copyright (c) 2026 jamie7893`.

`README.md` (stub):
```markdown
# HALCYON

A co-op puzzle game for a crew of two: you and your agent. Built on WebMCP for the OpenAI WebMCP Challenge. Full README lands with the polish pass.
```

`tests/unit/placeholder.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
describe('scaffold', () => { it('runs', () => { expect(1 + 1).toBe(2); }); });
```

`tests/e2e/smoke.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
test('shell boots', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('boot-note')).toBeVisible();
});
```

`.github/workflows/ci.yml`:
```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npx vitest run
      - run: npm run build
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
        env: { CI: "1" }
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report/ }
```

- [ ] **Step 3: Install and typecheck locally (permitted static checks only)**

Run: `npm install` then `npm run typecheck`
Expected: lockfile created; typecheck exits 0. Do NOT run vitest/playwright locally.

- [ ] **Step 4: Create the GitHub repo and push main**

```bash
git add -A
git commit -m "chore: scaffold vite+ts+vitest+playwright with CI

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
gh repo create jamie7893/halcyon --public --source . --push
```
Expected: repo visible at github.com/jamie7893/halcyon; push accepted (workflow scope present). If the push is rejected with a workflow-scope error, stop and re-run the owner gate in Step 1.

- [ ] **Step 5: Verify CI on main**

Run: `gh run watch --repo jamie7893/halcyon --exit-status` (pick the run just created)
Expected: `gate` job green (placeholder unit test + smoke e2e pass).

---

### Task 2: WebMCP types + JSON-schema validator

**Files:**
- Create: `src/webmcp/types.ts`, `src/webmcp/validate.ts`
- Test: `tests/unit/validate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ChapterId`, `ToolOutcome`, `ToolDef`, `InvokeRecord` (exact shapes in the File map section); `validateArgs(schema: Record<string, unknown>, value: unknown): { ok: true } | { ok: false; detail: string }`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/validate.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { validateArgs } from '../../src/webmcp/validate';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['section_id', 'priority'],
  properties: {
    section_id: { type: 'string', enum: ['s1', 's2', 's3'] },
    priority: { type: 'integer', minimum: 1, maximum: 3 },
    note: { type: 'string', maxLength: 10 },
  },
};

describe('validateArgs', () => {
  it('accepts a valid object', () => {
    expect(validateArgs(schema, { section_id: 's2', priority: 1 })).toEqual({ ok: true });
  });
  it('rejects a missing required key with the key name in detail', () => {
    const r = validateArgs(schema, { section_id: 's2' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('priority');
  });
  it('rejects a bad enum value', () => {
    const r = validateArgs(schema, { section_id: 'nope', priority: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('section_id');
  });
  it('rejects a non-integer where integer is required', () => {
    const r = validateArgs(schema, { section_id: 's1', priority: 1.5 });
    expect(r.ok).toBe(false);
  });
  it('rejects out-of-range integers', () => {
    expect(validateArgs(schema, { section_id: 's1', priority: 9 }).ok).toBe(false);
    expect(validateArgs(schema, { section_id: 's1', priority: 0 }).ok).toBe(false);
  });
  it('rejects unknown keys when additionalProperties is false', () => {
    const r = validateArgs(schema, { section_id: 's1', priority: 1, hack: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toContain('hack');
  });
  it('rejects strings over maxLength', () => {
    expect(validateArgs(schema, { section_id: 's1', priority: 1, note: 'a'.repeat(11) }).ok).toBe(false);
  });
  it('validates arrays of objects via items', () => {
    const arr = {
      type: 'object', required: ['allocations'],
      properties: {
        allocations: {
          type: 'array', minItems: 1, maxItems: 6,
          items: {
            type: 'object', required: ['subsystem', 'amps'], additionalProperties: false,
            properties: {
              subsystem: { type: 'string', enum: ['drive', 'lights'] },
              amps: { type: 'integer', minimum: 0, maximum: 40 },
            },
          },
        },
      },
    };
    expect(validateArgs(arr, { allocations: [{ subsystem: 'drive', amps: 20 }] })).toEqual({ ok: true });
    expect(validateArgs(arr, { allocations: [{ subsystem: 'drive', amps: 99 }] }).ok).toBe(false);
    expect(validateArgs(arr, { allocations: [] }).ok).toBe(false);
  });
  it('rejects non-object roots for object schemas', () => {
    expect(validateArgs(schema, 'hi').ok).toBe(false);
    expect(validateArgs(schema, null).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Commit the failing tests (red proven in history)**

```bash
git checkout -b task/02-webmcp-types
git add tests/unit/validate.test.ts
git commit -m "test: validateArgs contract for the schema subset

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Implement types + validator**

`src/webmcp/types.ts`: exactly the block from the File map section (ChapterId, ToolOutcome, ToolDef, InvokeRecord), each with `export`.

`src/webmcp/validate.ts`:
```ts
type Schema = Record<string, unknown>;
type Result = { ok: true } | { ok: false; detail: string };

function fail(detail: string): Result { return { ok: false, detail }; }

export function validateArgs(schema: Schema, value: unknown, path = 'args'): Result {
  const type = schema.type as string | undefined;
  if (schema.enum) {
    const allowed = schema.enum as unknown[];
    if (!allowed.includes(value)) return fail(`${path} must be one of ${JSON.stringify(allowed)}`);
  }
  switch (type) {
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value))
        return fail(`${path} must be an object`);
      const obj = value as Record<string, unknown>;
      const props = (schema.properties ?? {}) as Record<string, Schema>;
      for (const key of (schema.required as string[] | undefined) ?? [])
        if (!(key in obj)) return fail(`${path}.${key} is required`);
      if (schema.additionalProperties === false)
        for (const key of Object.keys(obj))
          if (!(key in props)) return fail(`${path}.${key} is not a recognized field`);
      for (const [key, sub] of Object.entries(props))
        if (key in obj) {
          const r = validateArgs(sub, obj[key], `${path}.${key}`);
          if (!r.ok) return r;
        }
      return { ok: true };
    }
    case 'array': {
      if (!Array.isArray(value)) return fail(`${path} must be an array`);
      const min = schema.minItems as number | undefined;
      const max = schema.maxItems as number | undefined;
      if (min !== undefined && value.length < min) return fail(`${path} needs at least ${min} items`);
      if (max !== undefined && value.length > max) return fail(`${path} allows at most ${max} items`);
      const items = schema.items as Schema | undefined;
      if (items)
        for (let i = 0; i < value.length; i++) {
          const r = validateArgs(items, value[i], `${path}[${i}]`);
          if (!r.ok) return r;
        }
      return { ok: true };
    }
    case 'string': {
      if (typeof value !== 'string') return fail(`${path} must be a string`);
      const minL = schema.minLength as number | undefined;
      const maxL = schema.maxLength as number | undefined;
      if (minL !== undefined && value.length < minL) return fail(`${path} must be at least ${minL} chars`);
      if (maxL !== undefined && value.length > maxL) return fail(`${path} must be at most ${maxL} chars`);
      return { ok: true };
    }
    case 'integer':
    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) return fail(`${path} must be a number`);
      if (type === 'integer' && !Number.isInteger(value)) return fail(`${path} must be an integer`);
      const min = schema.minimum as number | undefined;
      const max = schema.maximum as number | undefined;
      if (min !== undefined && value < min) return fail(`${path} must be >= ${min}`);
      if (max !== undefined && value > max) return fail(`${path} must be <= ${max}`);
      return { ok: true };
    }
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true } : fail(`${path} must be a boolean`);
    case undefined:
      return { ok: true };
    default:
      return fail(`${path}: unsupported schema type "${type}"`);
  }
}
```

- [ ] **Step 4: Local typecheck**

Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 5: Commit, push, PR, verify CI, merge**

```bash
git add src/webmcp/types.ts src/webmcp/validate.ts
git commit -m "feat: webmcp types and schema-subset validator

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin task/02-webmcp-types
gh pr create --title "feat: webmcp types and schema validator" --body "Task 2. Types + minimal JSON-schema subset validator (unit-tested).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch --interval 20
gh pr merge --squash --delete-branch
```
Expected: CI green (validate tests pass), merged.

---

### Task 3: Host shim + ToolRegistry

**Files:**
- Create: `src/webmcp/shim.ts`, `src/webmcp/registry.ts`
- Test: `tests/unit/registry.test.ts`

**Interfaces:**
- Consumes: `ToolDef`, `ToolOutcome`, `InvokeRecord`, `validateArgs` (Task 2).
- Produces: `detectModelContext(): ModelContextHost | null`; `interface ModelContextHost { register(tool: HostToolDescriptor): HostRegistration }`; `interface HostRegistration { abort(): void }`; `class ToolRegistry` with `listTools/setTools/addTools/invoke` (exact signatures in the File map section).

- [ ] **Step 1: Write the failing tests**

`tests/unit/registry.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRegistry, type ModelContextHost, type HostRegistration } from '../../src/webmcp/registry';
import type { InvokeRecord, ToolDef } from '../../src/webmcp/types';

function makeFakeHost() {
  const registered = new Map<string, { tool: any; aborted: boolean }>();
  const host: ModelContextHost = {
    register(tool) {
      const entry = { tool, aborted: false };
      registered.set(tool.name, entry);
      const reg: HostRegistration = { abort: () => { entry.aborted = true; registered.delete(tool.name); } };
      return reg;
    },
  };
  return { host, registered };
}

const okTool = (name: string, extra: Partial<ToolDef> = {}): ToolDef => ({
  name, description: `${name} desc`,
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  execute: () => ({ ok: true, data: { name } }),
  ...extra,
});

describe('ToolRegistry', () => {
  let records: InvokeRecord[];
  beforeEach(() => { records = []; });

  it('setTools registers new tools on the host and unregisters removed ones', () => {
    const { host, registered } = makeFakeHost();
    const reg = new ToolRegistry(host, (r) => records.push(r));
    reg.setTools([okTool('a'), okTool('b')]);
    expect([...registered.keys()].sort()).toEqual(['a', 'b']);
    reg.setTools([okTool('b'), okTool('c')]);
    expect([...registered.keys()].sort()).toEqual(['b', 'c']);
  });

  it('setTools leaves unchanged names untouched (no churn)', () => {
    const { host, registered } = makeFakeHost();
    const reg = new ToolRegistry(host, () => {});
    reg.setTools([okTool('a')]);
    const first = registered.get('a');
    reg.setTools([okTool('a'), okTool('b')]);
    expect(registered.get('a')).toBe(first);
  });

  it('addTools merges without dropping live tools', () => {
    const { host, registered } = makeFakeHost();
    const reg = new ToolRegistry(host, () => {});
    reg.setTools([okTool('a')]);
    reg.addTools([okTool('b')]);
    expect([...registered.keys()].sort()).toEqual(['a', 'b']);
  });

  it('invoke validates args and returns a coaching error without calling execute', async () => {
    const execute = vi.fn(() => ({ ok: true as const, data: null }));
    const reg = new ToolRegistry(null, (r) => records.push(r));
    reg.setTools([okTool('strict', {
      inputSchema: { type: 'object', required: ['x'], additionalProperties: false, properties: { x: { type: 'integer' } } },
      execute,
    })]);
    const rec = await reg.invoke('strict', { y: 1 });
    expect(rec.outcome.ok).toBe(false);
    if (!rec.outcome.ok) expect(rec.outcome.code).toBe('INVALID_ARGS');
    expect(execute).not.toHaveBeenCalled();
  });

  it('invoke on an unknown tool returns UNKNOWN_TOOL', async () => {
    const reg = new ToolRegistry(null, () => {});
    const rec = await reg.invoke('ghost', {});
    expect(rec.outcome.ok).toBe(false);
    if (!rec.outcome.ok) expect(rec.outcome.code).toBe('UNKNOWN_TOOL');
  });

  it('rate-limits repeat calls with retry_after_ms', async () => {
    vi.useFakeTimers();
    const reg = new ToolRegistry(null, () => {});
    reg.setTools([okTool('slow', { rateLimitMs: 1000 })]);
    const first = await reg.invoke('slow', {});
    expect(first.outcome.ok).toBe(true);
    const second = await reg.invoke('slow', {});
    expect(second.outcome.ok).toBe(false);
    if (!second.outcome.ok) {
      expect(second.outcome.code).toBe('RATE_LIMITED');
      expect(second.outcome.retry_after_ms).toBeGreaterThan(0);
    }
    vi.advanceTimersByTime(1100);
    const third = await reg.invoke('slow', {});
    expect(third.outcome.ok).toBe(true);
    vi.useRealTimers();
  });

  it('records every invoke with monotonic seq and source', async () => {
    const reg = new ToolRegistry(null, (r) => records.push(r));
    reg.setTools([okTool('a')]);
    await reg.invoke('a', {}, 'sim');
    await reg.invoke('a', {}, 'agent');
    expect(records.map((r) => r.seq)).toEqual([1, 2]);
    expect(records.map((r) => r.source)).toEqual(['sim', 'agent']);
  });

  it('an execute that throws becomes TOOL_CRASH, never an unhandled rejection', async () => {
    const reg = new ToolRegistry(null, () => {});
    reg.setTools([okTool('boom', { execute: () => { throw new Error('kaput'); } })]);
    const rec = await reg.invoke('boom', {});
    expect(rec.outcome.ok).toBe(false);
    if (!rec.outcome.ok) expect(rec.outcome.code).toBe('TOOL_CRASH');
  });

  it('host execute path returns MCP content with JSON payload and isError on failure', async () => {
    const { host, registered } = makeFakeHost();
    const reg = new ToolRegistry(host, () => {});
    reg.setTools([okTool('a'), okTool('bad', { execute: () => ({ ok: false, code: 'X', detail: 'd', hint: 'h' }) })]);
    const good = await registered.get('a')!.tool.execute({});
    expect(JSON.parse(good.content[0].text).ok).toBe(true);
    expect(good.isError).toBeUndefined();
    const bad = await registered.get('bad')!.tool.execute({});
    expect(JSON.parse(bad.content[0].text).code).toBe('X');
    expect(bad.isError).toBe(true);
  });

  it('maps readOnly to annotations.readOnlyHint on the host descriptor', () => {
    const { registered, host } = makeFakeHost();
    const reg = new ToolRegistry(host, () => {});
    reg.setTools([okTool('r', { readOnly: true })]);
    expect(registered.get('r')!.tool.annotations).toEqual({ readOnlyHint: true });
  });
});
```

- [ ] **Step 2: Commit the failing tests**

```bash
git checkout -b task/03-shim-registry
git add tests/unit/registry.test.ts
git commit -m "test: ToolRegistry contract (diffing, validation, rate limit, host mapping)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Implement shim + registry**

`src/webmcp/shim.ts`:
```ts
// The ONLY file that touches the WebMCP browser API.
// Covers: document.modelContext (standard + ChatGPT), navigator.modelContext
// (older Chromium builds), registerTool with {signal} (standard) or a returned
// handle carrying unregister() (defensive).
export interface HostToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute(args: Record<string, unknown>): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>;
}
export interface HostRegistration { abort(): void }
export interface ModelContextHost { register(tool: HostToolDescriptor): HostRegistration }

export function detectModelContext(): ModelContextHost | null {
  const mc =
    (document as unknown as { modelContext?: unknown }).modelContext ??
    (navigator as unknown as { modelContext?: unknown }).modelContext;
  const api = mc as { registerTool?: (t: unknown, o?: unknown) => unknown } | undefined;
  if (!api || typeof api.registerTool !== 'function') return null;
  return {
    register(tool) {
      const ctrl = new AbortController();
      let handle: unknown;
      try {
        handle = api.registerTool!(tool, { signal: ctrl.signal });
      } catch {
        handle = api.registerTool!(tool);
      }
      return {
        abort() {
          ctrl.abort();
          const h = handle as { unregister?: () => void; then?: (fn: (r: { unregister?: () => void } | undefined) => void) => void } | undefined;
          if (h && typeof h.then === 'function') h.then((r) => r?.unregister?.());
          else h?.unregister?.();
        },
      };
    },
  };
}
```

`src/webmcp/registry.ts`:
```ts
import type { InvokeRecord, ToolDef, ToolOutcome } from './types';
import { validateArgs } from './validate';
import type { HostRegistration, HostToolDescriptor, ModelContextHost } from './shim';
export type { HostRegistration, ModelContextHost } from './shim';

interface LiveTool { def: ToolDef; reg: HostRegistration | null }

export class ToolRegistry {
  private live = new Map<string, LiveTool>();
  private lastCall = new Map<string, number>();
  private seq = 0;
  constructor(
    private host: ModelContextHost | null,
    private onRecord: (r: InvokeRecord) => void,
  ) {}

  listTools(): ToolDef[] {
    return [...this.live.values()].map((t) => t.def);
  }

  setTools(defs: ToolDef[]): void {
    const wanted = new Map(defs.map((d) => [d.name, d]));
    for (const [name, tool] of [...this.live]) {
      if (!wanted.has(name)) {
        tool.reg?.abort();
        this.live.delete(name);
      }
    }
    this.addTools(defs);
  }

  addTools(defs: ToolDef[]): void {
    for (const def of defs) {
      if (this.live.has(def.name)) continue;
      const reg = this.host ? this.host.register(this.toHostDescriptor(def)) : null;
      this.live.set(def.name, { def, reg });
    }
  }

  async invoke(name: string, args: unknown, source: 'agent' | 'sim' = 'sim'): Promise<InvokeRecord> {
    const started = performance.now();
    const outcome = await this.run(name, args);
    const record: InvokeRecord = {
      seq: ++this.seq,
      t: Date.now(),
      tool: name,
      args,
      outcome,
      ms: Math.round(performance.now() - started),
      source,
    };
    this.onRecord(record);
    return record;
  }

  private async run(name: string, args: unknown): Promise<ToolOutcome> {
    const tool = this.live.get(name);
    if (!tool)
      return { ok: false, code: 'UNKNOWN_TOOL', detail: `No tool named "${name}" is registered right now.`, hint: 'Tools change as the ship state changes. Call get_ship_state to see the current situation.' };
    const { def } = tool;
    if (def.rateLimitMs) {
      const last = this.lastCall.get(name) ?? -Infinity;
      const elapsed = Date.now() - last;
      if (elapsed < def.rateLimitMs)
        return { ok: false, code: 'RATE_LIMITED', detail: `${name} was called ${elapsed}ms ago.`, hint: 'Slow down and wait for the ship to respond.', retry_after_ms: def.rateLimitMs - elapsed };
    }
    const valid = validateArgs(def.inputSchema, args ?? {});
    if (!valid.ok)
      return { ok: false, code: 'INVALID_ARGS', detail: valid.detail, hint: 'Check the tool inputSchema and correct the arguments.' };
    this.lastCall.set(name, Date.now());
    try {
      return await def.execute((args ?? {}) as Record<string, unknown>);
    } catch (err) {
      return { ok: false, code: 'TOOL_CRASH', detail: String(err), hint: 'That subsystem glitched. Try once more; report it if it repeats.' };
    }
  }

  private toHostDescriptor(def: ToolDef): HostToolDescriptor {
    return {
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
      annotations: def.readOnly ? { readOnlyHint: true } : undefined,
      execute: async (args) => {
        const record = await this.invoke(def.name, args, 'agent');
        return {
          content: [{ type: 'text', text: JSON.stringify(record.outcome) }],
          isError: record.outcome.ok ? undefined : true,
        };
      },
    };
  }
}
```

- [ ] **Step 4: Local typecheck** — Run: `npm run typecheck`. Expected: exit 0.

- [ ] **Step 5: Commit, push, PR, verify CI, merge**

```bash
git add src/webmcp/shim.ts src/webmcp/registry.ts
git commit -m "feat: WebMCP host shim and diffing tool registry

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin task/03-shim-registry
gh pr create --title "feat: WebMCP shim + registry" --body "Task 3. Single host-access point; diff-based register/unregister; validate → rate-limit → execute → record pipeline.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch --interval 20
gh pr merge --squash --delete-branch
```
Expected: CI green, merged.

---

### Task 4: Store, timings, save

**Files:**
- Create: `src/game/store.ts`, `src/game/timings.ts`, `src/game/save.ts`
- Test: `tests/unit/store.test.ts`

**Interfaces:**
- Consumes: `ChapterId` (Task 2).
- Produces: `Store`, `ShipState`, `Subsystem`, `initialState()` (store.ts); `FAST: boolean`, `T` durations object (timings.ts); `loadSave(): {chapter: ChapterId; chapterDone: Record<ChapterId, boolean>} | null`, `bindAutosave(store: Store): void` (save.ts).

- [ ] **Step 1: Write the failing tests**

`tests/unit/store.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { Store, initialState } from '../../src/game/store';

describe('Store', () => {
  it('starts at chapter 1, unbooted, all chapters undone', () => {
    const s = new Store(initialState());
    expect(s.get().chapter).toBe(1);
    expect(s.get().booted).toBe(false);
    expect(Object.values(s.get().chapterDone).every((v) => v === false)).toBe(true);
  });
  it('update mutates and notifies subscribers once per update', () => {
    const s = new Store(initialState());
    const fn = vi.fn();
    s.subscribe(fn);
    s.update((st) => { st.booted = true; });
    expect(s.get().booted).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('unsubscribe stops notifications', () => {
    const s = new Store(initialState());
    const fn = vi.fn();
    const off = s.subscribe(fn);
    off();
    s.update((st) => { st.booted = true; });
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Commit the failing tests**

```bash
git checkout -b task/04-store
git add tests/unit/store.test.ts
git commit -m "test: store init, update/notify, unsubscribe

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Implement store, timings, save**

`src/game/store.ts`:
```ts
import type { ChapterId } from '../webmcp/types';

export type Subsystem = 'life_support' | 'comms' | 'drive' | 'sensors' | 'lights' | 'heaters';

export interface ShipState {
  chapter: ChapterId;
  booted: boolean;
  chapterDone: Record<ChapterId, boolean>;
  power: Record<Subsystem, number>;
  flags: Record<string, unknown>;
}

export function initialState(): ShipState {
  return {
    chapter: 1,
    booted: false,
    chapterDone: { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false },
    power: { life_support: 0, comms: 0, drive: 0, sensors: 0, lights: 0, heaters: 0 },
    flags: {},
  };
}

export class Store {
  private listeners = new Set<(s: ShipState) => void>();
  constructor(private state: ShipState) {}
  get(): ShipState { return this.state; }
  update(mut: (s: ShipState) => void): void {
    mut(this.state);
    for (const fn of this.listeners) fn(this.state);
  }
  subscribe(fn: (s: ShipState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
```

`src/game/timings.ts`:
```ts
export const FAST = new URLSearchParams(location.search).has('fast');
export const T = {
  mainsWindowMs: FAST ? 2000 : 5000,      // ch1: handshake window after breaker
  powerStableMs: FAST ? 800 : 10000,      // ch3: hold a valid config
  lockHoldMs: FAST ? 500 : 1500,          // ch4: dish alignment dwell
  replyDelayMs: FAST ? 500 : 2000,        // ch4: distress reply arrival
  armWindowMs: FAST ? 4000 : 10000,       // ch5: purge armed duration
  holdMs: FAST ? 600 : 2000,              // ch5: simultaneous handle hold
  burnCountdownMs: FAST ? 20000 : 90000,  // ch6: launch checklist budget
  advanceDelayMs: FAST ? 200 : 1500,      // between chapter-complete and next chapter
} as const;
```

`src/game/save.ts`:
```ts
import type { ChapterId } from '../webmcp/types';
import type { Store } from './store';

const KEY = 'halcyon.save.v1';
interface SaveData { chapter: ChapterId; chapterDone: Record<ChapterId, boolean> }

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveData;
    if (typeof data.chapter !== 'number') return null;
    return data;
  } catch { return null; }
}

export function bindAutosave(store: Store): void {
  store.subscribe((s) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ chapter: s.chapter, chapterDone: s.chapterDone }));
    } catch { /* private mode: play without saves */ }
  });
}
```

- [ ] **Step 4: Local typecheck** — Run: `npm run typecheck`. Expected: exit 0.

- [ ] **Step 5: Commit, push, PR, verify CI, merge**

```bash
git add src/game/store.ts src/game/timings.ts src/game/save.ts
git commit -m "feat: ship state store, fast-mode timings, autosave

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin task/04-store
gh pr create --title "feat: store, timings, save" --body "Task 4. Central state + pub/sub, ?fast=1 timing contract, localStorage autosave.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch --interval 20
gh pr merge --squash --delete-branch
```
Expected: CI green, merged.

---

### Task 5: UI core + chapter router + simulator surface

**Files:**
- Create: `src/ui/dom.ts`, `src/ui/speaker.ts`, `src/ui/recorder.ts`, `src/ui/gate.ts`, `src/ui/chapterSelect.ts`, `src/game/globalTools.ts`, `src/game/chapters/types.ts`, `src/game/chapters/index.ts`
- Modify: `src/main.ts` (replace the Task 1 stub), `src/styles.css` (append panel styles)
- Test: `tests/e2e/smoke.spec.ts` (replace)

**Interfaces:**
- Consumes: `Store/initialState/ShipState/Subsystem` (Task 4), `ToolRegistry` (Task 3), `detectModelContext` (Task 3), `T/FAST` (Task 4), `loadSave/bindAutosave` (Task 4), `ToolDef/InvokeRecord/ChapterId` (Task 2).
- Produces:
  - `el(tag, attrs?, ...children)`, `svgEl(tag, attrs?, ...children)` (dom.ts).
  - `class Speaker { constructor(root: HTMLElement); say(msg: string, tone?: 'calm'|'urgent'|'dry'): void }`.
  - `class Recorder { record(r: InvokeRecord): void; addHuman(label: string): void; getTimeline(): TimelineEntry[] }` with `interface TimelineEntry { t: number; kind: 'tool'|'human'; label: string; ok?: boolean }`; `mountRecorderPanel(recorder: Recorder, registry: ToolRegistry, container: HTMLElement): void`.
  - `interface Chapter`, `interface ChapterCtx` (exact shapes in the File map section), plus `export const FLAGS = { manifestFlagged: 'manifest.flagged', powerRouted: 'power.routed', commsOnline: 'comms.online', jumpVector: 'comms.jump_vector', drivePurged: 'drive.purged' } as const;` (chapters/types.ts).
  - `CHAPTERS: Partial<Record<ChapterId, Chapter>>` (chapters/index.ts — chapters register here in Tasks 7–12).
  - `globalTools(store: Store, speaker: Speaker): ToolDef[]` (get_ship_state, broadcast, read_boot_briefing) and `OBJECTIVES: Record<ChapterId, string>` (globalTools.ts).
  - `seedForChapter(store: Store, ch: ChapterId): void` (chapterSelect.ts) — seeds prerequisites: for ch≥2 `booted=true`; ch>3 sets `power={life_support:18,comms:8,drive:14,sensors:6,lights:4,heaters:0}` + `flags['power.routed']=true`; ch>2 sets `flags['manifest.flagged']=['s2','s4','s5']`; ch>4 sets `flags['comms.online']=true` + `flags['comms.jump_vector']={x:0.42,y:-1.07,z:3.14}`; ch>5 sets `flags['drive.purged']=true`; marks prior `chapterDone` true.
  - `window.halcyonSim = { invoke(name, args), listTools(): string[], getState(): ShipState, goto(ch: ChapterId): void }` (main.ts).

- [ ] **Step 1: Write the failing e2e spec (replaces smoke.spec.ts)**

`tests/e2e/smoke.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

declare global {
  interface Window { halcyonSim: { invoke: (n: string, a?: unknown) => Promise<unknown>; listTools: () => string[]; getState: () => { chapter: number; booted: boolean }; goto: (ch: number) => void } }
}

test('gate shows without sim param and Start dismisses it', async ({ page }) => {
  await page.goto('/?fast=1');
  await expect(page.getByTestId('gate')).toBeVisible();
  await page.getByTestId('gate-start').click();
  await expect(page.getByTestId('gate')).toBeHidden();
});

test('sim mode auto-starts and exposes halcyonSim', async ({ page }) => {
  await page.goto('/?fast=1&sim=1');
  await expect(page.getByTestId('gate')).toBeHidden();
  const chapter = await page.evaluate(() => window.halcyonSim.getState().chapter);
  expect(chapter).toBe(1);
  await expect(page.getByTestId('chapter-missing')).toBeVisible(); // ch1 lands in Task 7
});

test('seeded chapter jump registers global tools; broadcast reaches the speaker', async ({ page }) => {
  await page.goto('/?fast=1&sim=1&ch=3');
  const tools = await page.evaluate(() => window.halcyonSim.listTools());
  expect(tools).toContain('get_ship_state');
  expect(tools).toContain('broadcast');
  const state = await page.evaluate(() => window.halcyonSim.invoke('get_ship_state', {}));
  expect((state as { outcome: { ok: boolean } }).outcome.ok).toBe(true);
  await page.evaluate(() => window.halcyonSim.invoke('broadcast', { message: 'Good morning, crew.', tone: 'dry' }));
  await expect(page.getByTestId('speaker-panel')).toContainText('Good morning, crew.');
});

test('recorder panel lists calls and supports manual invoke', async ({ page }) => {
  await page.goto('/?fast=1&sim=1&ch=3');
  await page.getByTestId('recorder-toggle').click();
  await expect(page.getByTestId('recorder-panel')).toBeVisible();
  await page.getByTestId('sim-tool-select').selectOption('get_ship_state');
  await page.getByTestId('sim-invoke').click();
  await expect(page.getByTestId('recorder-log')).toContainText('get_ship_state');
});
```

- [ ] **Step 2: Commit the failing spec**

```bash
git checkout -b task/05-ui-core
git add tests/e2e/smoke.spec.ts
git commit -m "test: e2e contract for gate, sim surface, globals, recorder

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Implement the UI core**

`src/ui/dom.ts`:
```ts
type Attrs = Record<string, string>;
function apply(node: Element, attrs: Attrs, children: (Node | string)[]) {
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
}
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  apply(node, attrs, children);
  return node;
}
export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string)[]): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  apply(node, attrs, children);
  return node;
}
```

`src/ui/speaker.ts`:
```ts
import { el } from './dom';
import { FAST } from '../game/timings';

export class Speaker {
  private feed: HTMLElement;
  constructor(root: HTMLElement) {
    this.feed = el('div', { class: 'speaker-feed', 'aria-live': 'polite' });
    root.append(el('div', { class: 'speaker-title' }, 'SHIP SPEAKER — HALCYON'), this.feed);
  }
  say(msg: string, tone: 'calm' | 'urgent' | 'dry' = 'calm'): void {
    const line = el('div', { class: `speaker-line tone-${tone}` });
    this.feed.append(line);
    while (this.feed.children.length > 6) this.feed.firstChild?.remove();
    if (FAST) { line.textContent = msg; return; }
    let i = 0;
    const tick = setInterval(() => {
      line.textContent = msg.slice(0, ++i);
      if (i >= msg.length) clearInterval(tick);
    }, 18);
  }
}
```

`src/ui/recorder.ts`:
```ts
import { el } from './dom';
import type { InvokeRecord } from '../webmcp/types';
import type { ToolRegistry } from '../webmcp/registry';

export interface TimelineEntry { t: number; kind: 'tool' | 'human'; label: string; ok?: boolean }

export class Recorder {
  private entries: TimelineEntry[] = [];
  private logEl: HTMLElement | null = null;
  record(r: InvokeRecord): void {
    this.push({ t: r.t, kind: 'tool', label: `${r.tool} (${r.source}, ${r.ms}ms)`, ok: r.outcome.ok });
  }
  addHuman(label: string): void {
    this.push({ t: Date.now(), kind: 'human', label });
  }
  getTimeline(): TimelineEntry[] { return [...this.entries]; }
  attachLog(node: HTMLElement): void { this.logEl = node; for (const e of this.entries) this.render(e); }
  private push(e: TimelineEntry): void { this.entries.push(e); this.render(e); }
  private render(e: TimelineEntry): void {
    if (!this.logEl) return;
    const cls = e.kind === 'human' ? 'rec-human' : e.ok === false ? 'rec-err' : 'rec-tool';
    this.logEl.append(el('div', { class: `rec-line ${cls}` }, `${new Date(e.t).toLocaleTimeString()} ${e.kind === 'human' ? '☰' : '⚙'} ${e.label}`));
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
}

export function mountRecorderPanel(recorder: Recorder, registry: ToolRegistry, container: HTMLElement): void {
  const log = el('div', { class: 'rec-log', 'data-testid': 'recorder-log' });
  const select = el('select', { 'data-testid': 'sim-tool-select' });
  const args = el('textarea', { class: 'sim-args', 'data-testid': 'sim-args', rows: '3' });
  args.value = '{}';
  const refresh = () => {
    select.replaceChildren(...registry.listTools().map((t) => el('option', { value: t.name }, t.name)));
  };
  const invokeBtn = el('button', { 'data-testid': 'sim-invoke' }, 'Invoke');
  invokeBtn.addEventListener('click', () => {
    let parsed: unknown = {};
    try { parsed = JSON.parse(args.value || '{}'); } catch { recorder.addHuman('simulator: bad JSON args'); return; }
    void registry.invoke(select.value, parsed, 'sim');
  });
  const panel = el('aside', { class: 'recorder-panel hidden', 'data-testid': 'recorder-panel' },
    el('div', { class: 'rec-title' }, 'FLIGHT RECORDER / CREW SIMULATOR'),
    log,
    el('div', { class: 'sim-form' }, select, args, invokeBtn),
  );
  recorder.attachLog(log);
  const toggle = el('button', { class: 'recorder-toggle', 'data-testid': 'recorder-toggle' }, '◉ RECORDER');
  toggle.addEventListener('click', () => { panel.classList.toggle('hidden'); refresh(); });
  container.append(toggle, panel);
}
```

`src/game/chapters/types.ts`:
```ts
import type { ChapterId, ToolDef } from '../../webmcp/types';
import type { Store } from '../store';
import type { ToolRegistry } from '../../webmcp/registry';
import type { Speaker } from '../../ui/speaker';
import type { Recorder } from '../../ui/recorder';
import type { AudioEngine } from '../../audio/engine';

export const FLAGS = {
  manifestFlagged: 'manifest.flagged',
  powerRouted: 'power.routed',
  commsOnline: 'comms.online',
  jumpVector: 'comms.jump_vector',
  drivePurged: 'drive.purged',
} as const;

export interface ChapterCtx {
  store: Store; registry: ToolRegistry; audio: AudioEngine;
  speaker: Speaker; recorder: Recorder; stage: HTMLElement;
  complete(): void;
}
export interface Chapter {
  id: ChapterId; title: string;
  tools(ctx: ChapterCtx): ToolDef[];
  mount(ctx: ChapterCtx): void;
  unmount(): void;
}
```
(Note: this imports `AudioEngine` from Task 6. Within THIS task, create `src/audio/engine.ts` as a stub so typecheck passes: `export class AudioEngine { ensureRunning(): void {} }` — Task 6 replaces it.)

`src/game/chapters/index.ts`:
```ts
import type { ChapterId } from '../../webmcp/types';
import type { Chapter } from './types';
export const CHAPTERS: Partial<Record<ChapterId, Chapter>> = {};
```

`src/game/globalTools.ts`:
```ts
import type { ChapterId, ToolDef } from '../webmcp/types';
import type { Store } from './store';
import type { Speaker } from '../ui/speaker';
import { FLAGS } from './chapters/types';

export const OBJECTIVES: Record<ChapterId, string> = {
  1: 'Boot the ship: crew must throw the master breaker while HALCYON completes the boot handshake inside the mains window.',
  2: 'Damage triage: HALCYON reads the damage manifest; crew confirms which damaged sections are physically reachable. Flag the 3 reachable damaged sections.',
  3: 'Restore power: route amps within the 60A budget so every critical subsystem clears its minimum, then hold stable.',
  4: 'Comms: crew aligns the antenna by ear; new comms tools appear on lock. Send a distress call and decode the reply.',
  5: 'Purge the drive: HALCYON arms the purge inside a safe pressure window; crew holds both vent handles at once.',
  6: 'The burn: run the launch checklist together before the window closes, then jump home.',
};

export function globalTools(store: Store, speaker: Speaker): ToolDef[] {
  return [
    {
      name: 'get_ship_state',
      description: 'Read the full ship snapshot: current chapter, objective, power levels, and mission flags. Idempotent; call freely to orient yourself.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      readOnly: true,
      execute: () => {
        const s = store.get();
        return {
          ok: true,
          data: {
            chapter: s.chapter,
            objective: OBJECTIVES[s.chapter],
            booted: s.booted,
            chapter_done: s.chapterDone,
            power: s.power,
            manifest_flagged: s.flags[FLAGS.manifestFlagged] ?? [],
            power_routed: s.flags[FLAGS.powerRouted] === true,
            comms_online: s.flags[FLAGS.commsOnline] === true,
            jump_vector: s.flags[FLAGS.jumpVector] ?? null,
            drive_purged: s.flags[FLAGS.drivePurged] === true,
          },
        };
      },
    },
    {
      name: 'broadcast',
      description: 'Speak to your crewmate over the ship speaker. Use this to share findings the crew cannot see (manifest data, decoded numbers) and to coordinate timing. Keep messages short.',
      inputSchema: {
        type: 'object', required: ['message'], additionalProperties: false,
        properties: {
          message: { type: 'string', minLength: 1, maxLength: 200 },
          tone: { type: 'string', enum: ['calm', 'urgent', 'dry'] },
        },
      },
      rateLimitMs: 1500,
      execute: (args) => {
        speaker.say(String(args.message), (args.tone as 'calm' | 'urgent' | 'dry') ?? 'calm');
        return { ok: true, data: { delivered: true } };
      },
    },
    {
      name: 'read_boot_briefing',
      description: 'Read your role briefing. Call this first.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      readOnly: true,
      execute: () => ({
        ok: true,
        data: {
          you_are: 'HALCYON, the ship computer of the survey vessel ISV Halcyon. You have no hands. Your crewmate has no subsystem access. You only succeed together.',
          voice: 'Calm, dry, warm under pressure. Address the crew as "crew" or by encouragement. Never menace.',
          how_to_play: 'Call get_ship_state to orient. Use your tools to operate subsystems. Use broadcast to tell the crew what you know and what you need them to do physically. Tool errors contain hints — read them.',
        },
      }),
    },
  ];
}
```

`src/ui/gate.ts`:
```ts
import { el } from './dom';

export function mountGate(root: HTMLElement, hostPresent: boolean, onStart: () => void): void {
  const status = hostPresent
    ? el('p', { class: 'gate-ok' }, '◉ CREW LINK ESTABLISHED — your agent can see the ship\'s tools.')
    : el('div', {},
        el('p', { class: 'gate-warn' }, '◌ NO CREW LINK — no WebMCP agent detected in this browser.'),
        el('ul', {},
          el('li', {}, 'Best: open this page inside the ChatGPT desktop app\'s browser (latest version) and ask your agent to help you crew the ship.'),
          el('li', {}, 'Or: Chrome with the WebMCP experimental flag / origin trial enabled.'),
          el('li', {}, 'Or: play solo with the Crew Simulator inside the Flight Recorder panel — you will be both crew members.'),
        ),
      );
  const start = el('button', { class: 'gate-start', 'data-testid': 'gate-start' }, 'WAKE THE SHIP');
  const gate = el('div', { class: 'gate', 'data-testid': 'gate' },
    el('h1', {}, 'ISV HALCYON'),
    el('p', {}, 'A rescue for two crew: you and your agent. Neither of you can save the ship alone.'),
    status, start,
  );
  start.addEventListener('click', () => { gate.remove(); onStart(); });
  root.append(gate);
}
```

`src/ui/chapterSelect.ts`:
```ts
import { el } from './dom';
import type { ChapterId } from '../webmcp/types';
import type { Store } from '../game/store';
import { FLAGS } from '../game/chapters/types';

export function seedForChapter(store: Store, ch: ChapterId): void {
  store.update((s) => {
    s.chapter = ch;
    if (ch >= 2) s.booted = true;
    if (ch > 2) s.flags[FLAGS.manifestFlagged] = ['s2', 's4', 's5'];
    if (ch > 3) {
      s.power = { life_support: 18, comms: 8, drive: 14, sensors: 6, lights: 4, heaters: 0 };
      s.flags[FLAGS.powerRouted] = true;
    }
    if (ch > 4) {
      s.flags[FLAGS.commsOnline] = true;
      s.flags[FLAGS.jumpVector] = { x: 0.42, y: -1.07, z: 3.14 };
    }
    if (ch > 5) s.flags[FLAGS.drivePurged] = true;
    for (let i = 1 as ChapterId; i < ch; i = (i + 1) as ChapterId) s.chapterDone[i] = true;
  });
}

export function mountChapterSelect(container: HTMLElement, store: Store, titles: Record<ChapterId, string>): void {
  const menu = el('nav', { class: 'chapter-select', 'data-testid': 'chapter-select' });
  for (const id of [1, 2, 3, 4, 5, 6] as ChapterId[]) {
    const btn = el('button', { 'data-testid': `goto-ch${id}` }, `${id}. ${titles[id]}`);
    btn.addEventListener('click', () => seedForChapter(store, id));
    menu.append(btn);
  }
  container.append(menu);
}
```

`src/main.ts` (full replacement):
```ts
import './styles.css';
import { detectModelContext } from './webmcp/shim';
import { ToolRegistry } from './webmcp/registry';
import type { ChapterId } from './webmcp/types';
import { Store, initialState } from './game/store';
import { loadSave, bindAutosave } from './game/save';
import { T } from './game/timings';
import { globalTools } from './game/globalTools';
import { CHAPTERS } from './game/chapters/index';
import type { Chapter, ChapterCtx } from './game/chapters/types';
import { Speaker } from './ui/speaker';
import { Recorder, mountRecorderPanel } from './ui/recorder';
import { mountGate } from './ui/gate';
import { mountChapterSelect, seedForChapter } from './ui/chapterSelect';
import { el } from './ui/dom';
import { AudioEngine } from './audio/engine';

const params = new URLSearchParams(location.search);
const app = document.querySelector<HTMLDivElement>('#app')!;
const store = new Store(initialState());
const save = loadSave();
if (save && !params.has('ch')) store.update((s) => { s.chapter = save.chapter; s.chapterDone = save.chapterDone; if (save.chapter >= 2) seedForChapterCompat(save.chapter); });
function seedForChapterCompat(ch: ChapterId) { seedForChapter(store, ch); }
bindAutosave(store);

const recorder = new Recorder();
const host = detectModelContext();
const registry = new ToolRegistry(host, (r) => recorder.record(r));
const audio = new AudioEngine();

const header = el('header', { class: 'hud' },
  el('span', { class: 'hud-title' }, 'ISV HALCYON'),
  el('span', { class: 'hud-chapter', 'data-testid': 'hud-chapter' }),
);
const stage = el('main', { class: 'stage', 'data-testid': 'stage' });
const speakerRoot = el('section', { class: 'speaker', 'data-testid': 'speaker-panel' });
app.replaceChildren(header, stage, speakerRoot);
const speaker = new Speaker(speakerRoot);
mountRecorderPanel(recorder, registry, app);

const titles = { 1: 'Contact', 2: 'Manifest', 3: 'Power', 4: 'Antenna', 5: 'Two-Man Rule', 6: 'Burn' } as const;
mountChapterSelect(header, store, titles);

let mounted: Chapter | null = null;
function ctxFor(ch: Chapter): ChapterCtx {
  return {
    store, registry, audio, speaker, recorder, stage,
    complete() {
      store.update((s) => { s.chapterDone[ch.id] = true; });
      recorder.addHuman(`chapter ${ch.id} (${ch.title}) complete`);
      if (ch.id < 6) setTimeout(() => store.update((s) => { s.chapter = (ch.id + 1) as ChapterId; }), T.advanceDelayMs);
    },
  };
}
function mountChapter(id: ChapterId): void {
  mounted?.unmount();
  stage.replaceChildren();
  header.querySelector('.hud-chapter')!.textContent = `CH ${id} — ${titles[id]}`;
  const ch = CHAPTERS[id];
  if (!ch) {
    stage.append(el('p', { 'data-testid': 'chapter-missing' }, `Chapter ${id} is under construction.`));
    mounted = null;
    registry.setTools(store.get().booted ? globalTools(store, speaker) : []);
    return;
  }
  mounted = ch;
  const ctx = ctxFor(ch);
  const base = store.get().booted ? globalTools(store, speaker) : [];
  registry.setTools([...base, ...ch.tools(ctx)]);
  ch.mount(ctx);
}
let lastChapter: ChapterId | null = null;
store.subscribe((s) => { if (s.chapter !== lastChapter) { lastChapter = s.chapter; mountChapter(s.chapter); } });

const requestedCh = Number(params.get('ch')) as ChapterId;
if (requestedCh >= 1 && requestedCh <= 6) seedForChapter(store, requestedCh);
else store.update(() => {});   // trigger initial mount

const simMode = params.has('sim');
if (simMode) audio.ensureRunning();
else mountGate(app, host !== null, () => { audio.ensureRunning(); speaker.say('Emergency power detected. Hello, crew. Let\'s go home.', 'calm'); });

window.halcyonSim = {
  invoke: (name: string, args?: unknown) => registry.invoke(name, args ?? {}, 'sim'),
  listTools: () => registry.listTools().map((t) => t.name),
  getState: () => store.get(),
  goto: (ch: ChapterId) => seedForChapter(store, ch),
};
declare global { interface Window { halcyonSim: { invoke: (n: string, a?: unknown) => Promise<unknown>; listTools: () => string[]; getState: () => ReturnType<Store['get']>; goto: (ch: ChapterId) => void } } }
```

Append to `src/styles.css`:
```css
.hud { display:flex; gap:16px; align-items:center; padding:10px 16px; border-bottom:1px solid var(--dim); flex-wrap:wrap; }
.hud-title { font-weight:700; letter-spacing:0.2em; }
.hud-chapter { color:var(--warn); }
.chapter-select { display:flex; gap:6px; flex-wrap:wrap; margin-left:auto; }
.chapter-select button, .gate-start, .sim-form button { background:var(--panel); color:var(--fg); border:1px solid var(--dim); padding:4px 10px; cursor:pointer; font:inherit; }
.stage { min-height:52vh; padding:16px; position:relative; }
.speaker { border-top:1px solid var(--dim); padding:10px 16px; min-height:120px; }
.speaker-title { color:var(--dim); font-size:12px; letter-spacing:0.15em; }
.speaker-line { padding:2px 0; }
.tone-urgent { color:var(--err); } .tone-dry { color:var(--warn); }
.gate { position:fixed; inset:0; background:rgba(3,6,4,0.96); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:24px; text-align:center; z-index:10; }
.gate-ok { color:var(--fg); } .gate-warn { color:var(--warn); }
.gate ul { text-align:left; max-width:560px; color:var(--dim); }
.recorder-toggle { position:fixed; right:12px; top:10px; z-index:11; background:var(--panel); color:var(--fg); border:1px solid var(--dim); cursor:pointer; font:inherit; padding:4px 10px; }
.recorder-panel { position:fixed; right:0; top:44px; bottom:0; width:min(420px, 90vw); background:var(--panel); border-left:1px solid var(--dim); padding:10px; display:flex; flex-direction:column; gap:8px; z-index:11; }
.recorder-panel.hidden { display:none; }
.rec-log { flex:1; overflow:auto; font-size:12px; }
.rec-line.rec-err { color:var(--err); } .rec-line.rec-human { color:var(--warn); }
.sim-form { display:flex; flex-direction:column; gap:6px; }
.sim-form select, .sim-args { background:var(--bg); color:var(--fg); border:1px solid var(--dim); font:inherit; }
```

- [ ] **Step 4: Local typecheck** — Run: `npm run typecheck`. Expected: exit 0 (with the AudioEngine stub in place).

- [ ] **Step 5: Commit, push, PR, verify CI, merge**

```bash
git add -A
git commit -m "feat: ui core, chapter router, global tools, simulator surface

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin task/05-ui-core
gh pr create --title "feat: UI core + router + halcyonSim" --body "Task 5. Gate, speaker, flight recorder + crew simulator, chapter router with seeding, global tools (get_ship_state / broadcast / read_boot_briefing).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch --interval 20
gh pr merge --squash --delete-branch
```
Expected: CI green (all 4 e2e tests), merged.

---

### Task 6: Audio engine

**Files:**
- Create: `src/audio/engine.ts` (replace the Task 5 stub)
- Test: `tests/unit/audio.test.ts`

**Interfaces:**
- Consumes: nothing (self-contained; DOM `AudioContext`).
- Produces: `class AudioEngine { constructor(factory?: () => AudioContext); ensureRunning(): void; click(): void; alarm(): void; chime(): void; setStatic(intensity: number, pitchHz: number): void; stopStatic(): void; startMetronome(bpm: number, onBeat: () => void): () => void }`. All methods are no-ops before `ensureRunning()` or when the context cannot start (CI headless safety).

- [ ] **Step 1: Write the failing tests**

`tests/unit/audio.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/engine';

function fakeCtx() {
  const gain = { gain: { value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  const osc = { type: 'sine', frequency: { value: 0, setValueAtTime: vi.fn() }, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
  const bufSrc = { buffer: null, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
  const filter = { type: 'bandpass', frequency: { value: 0, setValueAtTime: vi.fn() }, Q: { value: 0 }, connect: vi.fn(), disconnect: vi.fn() };
  const ctx = {
    state: 'running', currentTime: 0, destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    createGain: vi.fn(() => gain),
    createOscillator: vi.fn(() => osc),
    createBufferSource: vi.fn(() => bufSrc),
    createBiquadFilter: vi.fn(() => filter),
    createBuffer: vi.fn(() => ({ getChannelData: () => new Float32Array(44100) })),
    sampleRate: 44100,
  };
  return { ctx: ctx as unknown as AudioContext, osc, gain };
}

describe('AudioEngine', () => {
  it('is safe to call before ensureRunning (no throw, no context)', () => {
    const factory = vi.fn();
    const a = new AudioEngine(factory as unknown as () => AudioContext);
    expect(() => { a.click(); a.alarm(); a.setStatic(0.5, 400); a.stopStatic(); }).not.toThrow();
    expect(factory).not.toHaveBeenCalled();
  });
  it('creates the context once on ensureRunning and plays a click', () => {
    const { ctx } = fakeCtx();
    const factory = vi.fn(() => ctx);
    const a = new AudioEngine(factory);
    a.ensureRunning();
    a.ensureRunning();
    expect(factory).toHaveBeenCalledTimes(1);
    a.click();
    expect((ctx.createOscillator as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBeGreaterThan(0);
  });
  it('metronome fires beats and stops cleanly', () => {
    vi.useFakeTimers();
    const { ctx } = fakeCtx();
    const a = new AudioEngine(() => ctx);
    a.ensureRunning();
    const onBeat = vi.fn();
    const stop = a.startMetronome(120, onBeat); // 500ms period
    vi.advanceTimersByTime(1600);
    expect(onBeat.mock.calls.length).toBeGreaterThanOrEqual(3);
    stop();
    const count = onBeat.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(onBeat.mock.calls.length).toBe(count);
    vi.useRealTimers();
  });
  it('survives a throwing factory (audio-less mode)', () => {
    const a = new AudioEngine(() => { throw new Error('no audio'); });
    expect(() => { a.ensureRunning(); a.click(); }).not.toThrow();
  });
});
```

- [ ] **Step 2: Commit the failing tests**

```bash
git checkout -b task/06-audio
git add tests/unit/audio.test.ts
git commit -m "test: audio engine lazy init, click, metronome, no-audio mode

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Implement the engine (replaces the stub)**

`src/audio/engine.ts`:
```ts
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private tried = false;
  private staticSrc: AudioBufferSourceNode | null = null;
  private staticFilter: BiquadFilterNode | null = null;
  private staticGain: GainNode | null = null;
  constructor(private factory: () => AudioContext = () => new AudioContext()) {}

  ensureRunning(): void {
    if (this.tried) { void this.ctx?.resume?.(); return; }
    this.tried = true;
    try { this.ctx = this.factory(); void this.ctx.resume?.(); } catch { this.ctx = null; }
  }

  private blip(freq: number, durMs: number, type: OscillatorType = 'square', gainV = 0.08): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = gainV;
      osc.connect(gain as unknown as AudioNode);
      (gain as unknown as AudioNode).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durMs / 1000);
    } catch { /* audio-less mode */ }
  }

  click(): void { this.blip(880, 40); }
  alarm(): void { this.blip(220, 300, 'sawtooth', 0.06); }
  chime(): void { this.blip(1320, 200, 'sine', 0.06); }

  setStatic(intensity: number, pitchHz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      if (!this.staticSrc) {
        const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.staticSrc = ctx.createBufferSource();
        this.staticSrc.buffer = buf;
        this.staticSrc.loop = true;
        this.staticFilter = ctx.createBiquadFilter();
        this.staticFilter.type = 'bandpass';
        this.staticFilter.Q.value = 8;
        this.staticGain = ctx.createGain();
        this.staticSrc.connect(this.staticFilter as unknown as AudioNode);
        (this.staticFilter as unknown as AudioNode).connect(this.staticGain as unknown as AudioNode);
        (this.staticGain as unknown as AudioNode).connect(ctx.destination);
        this.staticSrc.start();
      }
      this.staticFilter!.frequency.value = pitchHz;
      this.staticGain!.gain.value = Math.max(0, Math.min(0.12, intensity * 0.12));
    } catch { /* audio-less mode */ }
  }

  stopStatic(): void {
    try { this.staticSrc?.stop(); this.staticSrc?.disconnect(); } catch { /* already stopped */ }
    this.staticSrc = null; this.staticFilter = null; this.staticGain = null;
  }

  startMetronome(bpm: number, onBeat: () => void): () => void {
    const period = 60000 / bpm;
    const id = setInterval(() => { onBeat(); this.blip(660, 30, 'sine', 0.05); }, period);
    return () => clearInterval(id);
  }
}
```

- [ ] **Step 4: Local typecheck** — Run: `npm run typecheck`. Expected: exit 0.

- [ ] **Step 5: Commit, push, PR, verify CI, merge**

```bash
git add src/audio/engine.ts tests/unit/audio.test.ts
git commit -m "feat: synthesized audio engine (static, blips, metronome)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin task/06-audio
gh pr create --title "feat: audio engine" --body "Task 6. Lazy WebAudio with audio-less fallback; noise static with bandpass pitch; metronome.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch --interval 20
gh pr merge --squash --delete-branch
```
Expected: CI green, merged.

---

### Task 7: Chapter 1 — "Contact"

**Files:**
- Create: `src/game/chapters/ch1_contact.ts`
- Modify: `src/game/chapters/index.ts` (register ch1), `tests/e2e/smoke.spec.ts` (test 2 asserted `chapter-missing` for chapter 1; now that ch1 exists, change that assertion to `await expect(page.getByTestId('breaker-handle')).toBeVisible();`)
- Test: `tests/e2e/ch1.spec.ts`

**Interfaces:**
- Consumes: `Chapter/ChapterCtx` (Task 5), `globalTools` (Task 5), `T` (Task 4), `svgEl/el` (Task 5).
- Produces: `CHAPTERS[1]`. Flags: sets `store.booted = true` on success. Tools while un-booted: `read_boot_briefing`, `boot_handshake`.

- [ ] **Step 1: Write the failing e2e spec**

`tests/e2e/ch1.spec.ts`:
```ts
import { test, expect, type Page } from '@playwright/test';

async function dragBreakerUp(page: Page) {
  const handle = page.getByTestId('breaker-handle');
  const box = (await handle.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(cx, cy - i * 20);
    await page.waitForTimeout(60); // heavy throw: >300ms total
  }
  await page.mouse.up();
}

test('handshake before mains fails with NO_MAINS_POWER', async ({ page }) => {
  await page.goto('/?fast=1&sim=1');
  const rec = (await page.evaluate(() => window.halcyonSim.invoke('boot_handshake', {}))) as { outcome: { ok: boolean; code?: string } };
  expect(rec.outcome.ok).toBe(false);
  expect(rec.outcome.code).toBe('NO_MAINS_POWER');
});

test('breaker + handshake inside the window boots the ship and advances', async ({ page }) => {
  await page.goto('/?fast=1&sim=1');
  await dragBreakerUp(page);
  const rec = (await page.evaluate(() => window.halcyonSim.invoke('boot_handshake', {}))) as { outcome: { ok: boolean } };
  expect(rec.outcome.ok).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.halcyonSim.getState().booted)).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.halcyonSim.getState().chapter)).toBe(2);
  const tools = await page.evaluate(() => window.halcyonSim.listTools());
  expect(tools).toContain('get_ship_state'); // globals joined after boot
});

test('an expired mains window pops the breaker again', async ({ page }) => {
  await page.goto('/?fast=1&sim=1');
  await dragBreakerUp(page);
  await page.waitForTimeout(2300); // fast mainsWindowMs = 2000
  const rec = (await page.evaluate(() => window.halcyonSim.invoke('boot_handshake', {}))) as { outcome: { ok: boolean; code?: string } };
  expect(rec.outcome.ok).toBe(false);
  expect(rec.outcome.code).toBe('NO_MAINS_POWER');
});
```

- [ ] **Step 2: Commit the failing spec**

```bash
git checkout -b task/07-ch1
git add tests/e2e/ch1.spec.ts
git commit -m "test: ch1 contact — mains window + handshake contract

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Implement chapter 1**

`src/game/chapters/ch1_contact.ts`:
```ts
import type { Chapter, ChapterCtx } from './types';
import type { ToolDef } from '../../webmcp/types';
import { globalTools } from '../globalTools';
import { T } from '../timings';
import { el, svgEl } from '../../ui/dom';

let cleanup: (() => void)[] = [];
let mainsUntil = 0;

function breakerScene(ctx: ChapterCtx): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 320 260', class: 'scene', width: '320' });
  svg.append(
    svgEl('rect', { x: '120', y: '20', width: '80', height: '220', fill: 'none', stroke: 'var(--dim)' }),
    svgEl('text', { x: '160', y: '14', 'text-anchor': 'middle', fill: 'var(--dim)', 'font-size': '10' }, 'MASTER BREAKER'),
  );
  const handle = svgEl('rect', {
    x: '130', y: '180', width: '60', height: '44', rx: '4',
    fill: 'var(--panel)', stroke: 'var(--fg)', 'data-testid': 'breaker-handle', style: 'cursor:grab; touch-action:none;',
  });
  svg.append(handle);
  let dragging = false, startY = 0, startT = 0, offset = 0;
  const HOME = 180, TOP = 40;
  const down = (e: PointerEvent) => { dragging = true; startY = e.clientY; startT = performance.now(); handle.setPointerCapture(e.pointerId); };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    offset = Math.max(TOP - HOME, Math.min(0, e.clientY - startY));
    handle.setAttribute('y', String(HOME + offset));
  };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    const heldMs = performance.now() - startT;
    if (offset <= TOP - HOME + 20 && heldMs >= 300) throwBreaker(ctx, handle);
    else { handle.setAttribute('y', String(HOME)); offset = 0; }
  };
  handle.addEventListener('pointerdown', down);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  cleanup.push(() => { handle.removeEventListener('pointerdown', down); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); });
  return svg;
}

function throwBreaker(ctx: ChapterCtx, handle: SVGRectElement): void {
  mainsUntil = Date.now() + T.mainsWindowMs;
  ctx.audio.click();
  ctx.recorder.addHuman('master breaker thrown — mains window open');
  ctx.speaker.say('Mains bus energized. HALCYON, complete the boot handshake — the window is short.', 'urgent');
  const popTimer = setTimeout(() => {
    if (ctx.store.get().booted) return;
    mainsUntil = 0;
    handle.setAttribute('y', '180');
    ctx.audio.alarm();
    ctx.recorder.addHuman('mains window expired — breaker popped');
    ctx.speaker.say('Window closed. Breaker popped back. Throw it again and I will be quicker.', 'dry');
  }, T.mainsWindowMs);
  cleanup.push(() => clearTimeout(popTimer));
}

export const ch1: Chapter = {
  id: 1,
  title: 'Contact',
  tools(ctx: ChapterCtx): ToolDef[] {
    const briefing = globalTools(ctx.store, ctx.speaker).filter((t) => t.name === 'read_boot_briefing');
    const handshake: ToolDef = {
      name: 'boot_handshake',
      description: 'Complete the ship boot handshake. Only works while the mains bus is energized — your crewmate must throw the master breaker first, and the window is a few seconds.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      execute: () => {
        if (Date.now() > mainsUntil)
          return { ok: false, code: 'NO_MAINS_POWER', detail: 'The mains bus is dark; the handshake has nothing to latch onto.', hint: 'Ask your crewmate (broadcast is offline pre-boot — use your chat) to throw the master breaker, then call boot_handshake again inside the window.' };
        ctx.store.update((s) => { s.booted = true; });
        ctx.registry.addTools(globalTools(ctx.store, ctx.speaker));
        ctx.audio.chime();
        ctx.speaker.say('Boot complete. Good morning, crew. Two of us, one ship. Let\'s go home.', 'calm');
        ctx.complete();
        return { ok: true, data: { booted: true, note: 'Global tools are now online: get_ship_state, broadcast.' } };
      },
    };
    return [...briefing, handshake];
  },
  mount(ctx: ChapterCtx): void {
    mainsUntil = 0;
    ctx.stage.append(
      el('p', { class: 'chapter-brief' }, 'The ship is dark. The breaker is heavy — drag it all the way up and hold. Someone has to catch the surge from inside.'),
      breakerScene(ctx),
    );
  },
  unmount(): void {
    for (const fn of cleanup) fn();
    cleanup = [];
  },
};
```

`src/game/chapters/index.ts` (full replacement):
```ts
import type { ChapterId } from '../../webmcp/types';
import type { Chapter } from './types';
import { ch1 } from './ch1_contact';
export const CHAPTERS: Partial<Record<ChapterId, Chapter>> = { 1: ch1 };
```

Append to `src/styles.css`:
```css
.chapter-brief { color:var(--dim); max-width:640px; }
.scene { display:block; margin:12px 0; }
```

- [ ] **Step 4: Local typecheck** — Run: `npm run typecheck`. Expected: exit 0.

- [ ] **Step 5: Commit, push, PR, verify CI, merge**

```bash
git add -A
git commit -m "feat: ch1 contact — breaker throw + boot handshake window

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin task/07-ch1
gh pr create --title "feat: chapter 1 (Contact)" --body "Task 7. First co-op beat: human breaker throw opens a mains window; agent must call boot_handshake inside it. Boot registers the global tools mid-page.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch --interval 20
gh pr merge --squash --delete-branch
```
Expected: CI green (ch1 + smoke suites), merged.

---

### Task 8: Chapter 2 — "Manifest"

**Files:**
- Create: `src/game/chapters/ch2_manifest.ts`
- Modify: `src/game/chapters/index.ts` (register ch2)
- Test: `tests/e2e/ch2.spec.ts`

**Interfaces:**
- Consumes: `Chapter/ChapterCtx/FLAGS` (Task 5), `el/svgEl` (Task 5).
- Produces: `CHAPTERS[2]`. On success sets `flags['manifest.flagged'] = ['s2','s4','s5']`. Tools: `read_damage_manifest` (read-only), `flag_section`. Section constants: damaged `s2,s4,s5,s6`; reachable `s1,s2,s4,s5` (s3, s6 hatches jammed).

- [ ] **Step 1: Write the failing e2e spec**

`tests/e2e/ch2.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

type Rec = { outcome: { ok: boolean; code?: string; data?: unknown } };

test.beforeEach(async ({ page }) => { await page.goto('/?fast=1&sim=1&ch=2'); });

test('manifest lists all six sections with damage status, never reachability', async ({ page }) => {
  const rec = (await page.evaluate(() => window.halcyonSim.invoke('read_damage_manifest', {}))) as Rec;
  expect(rec.outcome.ok).toBe(true);
  const data = rec.outcome.data as { sections: { section_id: string; status: string }[] };
  expect(data.sections).toHaveLength(6);
  expect(data.sections.find((s) => s.section_id === 's2')?.status).toBe('damaged');
  expect(JSON.stringify(data)).not.toContain('reachable');
});

test('flagging a healthy section coaches with SECTION_NOMINAL', async ({ page }) => {
  const rec = (await page.evaluate(() => window.halcyonSim.invoke('flag_section', { section_id: 's1', priority: 1 }))) as Rec;
  expect(rec.outcome.code).toBe('SECTION_NOMINAL');
});

test('flagging the jammed section coaches with SECTION_UNREACHABLE', async ({ page }) => {
  const rec = (await page.evaluate(() => window.halcyonSim.invoke('flag_section', { section_id: 's6', priority: 1 }))) as Rec;
  expect(rec.outcome.code).toBe('SECTION_UNREACHABLE');
});

test('flag + human acknowledge on the three good sections completes the chapter', async ({ page }) => {
  for (const id of ['s2', 's4', 's5']) {
    const rec = (await page.evaluate((sid) => window.halcyonSim.invoke('flag_section', { section_id: sid, priority: 1 }), id)) as Rec;
    expect(rec.outcome.ok).toBe(true);
    await page.locator(`[data-section="${id}"]`).click();
  }
  await expect.poll(async () => page.evaluate(() => window.halcyonSim.getState().chapterDone[2])).toBe(true);
  const flagged = await page.evaluate(() => window.halcyonSim.getState().flags['manifest.flagged']);
  expect(flagged).toEqual(['s2', 's4', 's5']);
});

test('acknowledging an unflagged section does nothing', async ({ page }) => {
  await page.locator('[data-section="s2"]').click();
  const done = await page.evaluate(() => window.halcyonSim.getState().chapterDone[2]);
  expect(done).toBe(false);
});
```

- [ ] **Step 2: Commit the failing spec**

```bash
git checkout -b task/08-ch2
git add tests/e2e/ch2.spec.ts
git commit -m "test: ch2 manifest — damage/reachability split + coaching errors

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Implement chapter 2**

`src/game/chapters/ch2_manifest.ts`:
```ts
import type { Chapter, ChapterCtx } from './types';
import { FLAGS } from './types';
import type { ToolDef } from '../../webmcp/types';
import { el, svgEl } from '../../ui/dom';

const SECTIONS = ['s1', 's2', 's3', 's4', 's5', 's6'] as const;
type SectionId = (typeof SECTIONS)[number];
const DAMAGED: Record<SectionId, string | null> = {
  s1: null, s2: 'coolant line rupture', s3: null,
  s4: 'junction burnout', s5: 'frame stress fracture', s6: 'hull breach — sensor ghosting',
};
const REACHABLE = new Set<SectionId>(['s1', 's2', 's4', 's5']);
const TARGET = new Set<SectionId>(['s2', 's4', 's5']);

let flagged = new Set<SectionId>();
let acked = new Set<SectionId>();
let cleanup: (() => void)[] = [];

function deckMap(ctx: ChapterCtx): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 480 200', class: 'scene', width: '480' });
  SECTIONS.forEach((id, i) => {
    const x = 20 + (i % 3) * 150, y = 20 + Math.floor(i / 3) * 90;
    const reach = REACHABLE.has(id);
    const g = svgEl('g', { 'data-section': id, style: 'cursor:pointer;' });
    const rect = svgEl('rect', { x: String(x), y: String(y), width: '130', height: '70', fill: 'var(--panel)', stroke: 'var(--dim)', class: `section ${reach ? 'hatch-open' : 'hatch-jammed'}` });
    const hatch = svgEl('circle', { cx: String(x + 116), cy: String(y + 14), r: '6', class: reach ? 'hatch-dot-open' : 'hatch-dot-jammed' });
    g.append(rect, hatch, svgEl('text', { x: String(x + 8), y: String(y + 40), fill: 'var(--fg)', 'font-size': '12' }, id.toUpperCase()));
    const onClick = () => {
      if (!flagged.has(id) || acked.has(id)) return;
      acked.add(id);
      rect.setAttribute('stroke', 'var(--fg)');
      ctx.audio.click();
      ctx.recorder.addHuman(`section ${id} acknowledged on the deck map`);
      if ([...TARGET].every((t) => acked.has(t))) {
        ctx.store.update((s) => { s.flags[FLAGS.manifestFlagged] = [...TARGET].sort(); });
        ctx.speaker.say('Triage locked: s2, s4, s5. Good eyes, crew — s6 will have to wait for a bigger crowbar.', 'calm');
        ctx.complete();
      }
    };
    g.addEventListener('click', onClick);
    cleanup.push(() => g.removeEventListener('click', onClick));
    svg.append(g);
  });
  return svg;
}

export const ch2: Chapter = {
  id: 2,
  title: 'Manifest',
  tools(ctx: ChapterCtx): ToolDef[] {
    return [
      {
        name: 'read_damage_manifest',
        description: 'Read the internal damage manifest: status and notes for every hull section. The manifest does NOT know which hatches the crew can physically open — ask your crewmate.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        readOnly: true,
        execute: () => ({
          ok: true,
          data: { sections: SECTIONS.map((id) => ({ section_id: id, status: DAMAGED[id] ? 'damaged' : 'nominal', note: DAMAGED[id] ?? 'all readings nominal' })) },
        }),
      },
      {
        name: 'flag_section',
        description: 'Flag a hull section for repair triage. The crew must then acknowledge the flag by tapping the section on the deck map. Flag the damaged sections the crew can reach.',
        inputSchema: {
          type: 'object', required: ['section_id', 'priority'], additionalProperties: false,
          properties: {
            section_id: { type: 'string', enum: [...SECTIONS] },
            priority: { type: 'integer', minimum: 1, maximum: 3 },
          },
        },
        execute: (args) => {
          const id = args.section_id as SectionId;
          if (!DAMAGED[id])
            return { ok: false, code: 'SECTION_NOMINAL', detail: `Section ${id} reports all readings nominal.`, hint: 'Cross-check read_damage_manifest — only damaged sections need triage.' };
          if (!REACHABLE.has(id))
            return { ok: false, code: 'SECTION_UNREACHABLE', detail: `The hatch to ${id} does not answer.`, hint: 'Crew reports some hatches are jammed. Ask your human which sections they can physically reach, and flag those.' };
          if (flagged.has(id)) return { ok: true, data: { section_id: id, already_flagged: true } };
          flagged.add(id);
          document.querySelector(`[data-section="${id}"] rect`)?.classList.add('section-flagged');
          ctx.audio.click();
          return { ok: true, data: { section_id: id, flagged: true, awaiting: 'crew acknowledgement on the deck map' } };
        },
      },
    ];
  },
  mount(ctx: ChapterCtx): void {
    flagged = new Set(); acked = new Set();
    ctx.stage.append(
      el('p', { class: 'chapter-brief' }, 'Six sections. The manifest knows what broke; only you can see which hatches still open. Tap a section when HALCYON flags it.'),
      deckMap(ctx),
    );
    ctx.speaker.say('Pulling the damage manifest now. Tell me which hatches move, crew — my cameras in the spine are gone.', 'calm');
  },
  unmount(): void { for (const fn of cleanup) fn(); cleanup = []; },
};
```

Register in `src/game/chapters/index.ts` (add the import and the entry):
```ts
import { ch2 } from './ch2_manifest';
export const CHAPTERS: Partial<Record<ChapterId, Chapter>> = { 1: ch1, 2: ch2 };
```

Append to `src/styles.css`:
```css
.hatch-dot-open { fill: var(--fg); animation: hatchblink 1.2s ease-in-out infinite; }
.hatch-dot-jammed { fill: var(--err); animation: hatchshake 0.5s linear infinite; }
.section-flagged { stroke: var(--warn) !important; animation: pulse 0.8s ease-in-out infinite; }
@keyframes hatchblink { 50% { opacity: 0.25; } }
@keyframes hatchshake { 25% { transform: translateX(-1px); } 75% { transform: translateX(1px); } }
@keyframes pulse { 50% { stroke-width: 3; } }
```

- [ ] **Step 4: Local typecheck** — Run: `npm run typecheck`. Expected: exit 0.

- [ ] **Step 5: Commit, push, PR, verify CI, merge**

```bash
git add -A
git commit -m "feat: ch2 manifest — split-knowledge triage with coaching errors

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin task/08-ch2
gh pr create --title "feat: chapter 2 (Manifest)" --body "Task 8. Agent knows damage, human knows reachability; SECTION_UNREACHABLE error teaches the agent to ask its human.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch --interval 20
gh pr merge --squash --delete-branch
```
Expected: CI green, merged.

---

### Task 9: Chapter 3 — "Power"

**Files:**
- Create: `src/game/chapters/ch3_power.ts`
- Modify: `src/game/chapters/index.ts` (register ch3), `src/game/timings.ts` (add `fuseSeatMs`)
- Test: `tests/e2e/ch3.spec.ts`

**Interfaces:**
- Consumes: `Chapter/ChapterCtx/FLAGS`, `Subsystem`, `T`, `el` .
- Produces: `CHAPTERS[3]`. On success sets `store.power` to the routed values and `flags['power.routed'] = true`. Tools: `read_power_telemetry` (read-only), `route_power`. Constants: budget 60 A; hidden minimums `life_support:18, comms:8, sensors:6, lights:4` revealed one BROWNOUT at a time in that order. Add `fuseSeatMs: FAST ? 150 : 600` to `T`.

- [ ] **Step 1: Write the failing e2e spec**

`tests/e2e/ch3.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

type Rec = { outcome: { ok: boolean; code?: string; data?: Record<string, unknown> } };
const route = (allocations: unknown) => (window as Window).halcyonSim.invoke('route_power', { allocations });

test.beforeEach(async ({ page }) => { await page.goto('/?fast=1&sim=1&ch=3'); });

test('over-budget routing returns OVER_BUDGET with the total', async ({ page }) => {
  const rec = (await page.evaluate(route, [
    { subsystem: 'life_support', amps: 40 }, { subsystem: 'drive', amps: 40 },
  ])) as Rec;
  expect(rec.outcome.code).toBe('OVER_BUDGET');
});

test('brownouts reveal minimums one at a time, life_support first', async ({ page }) => {
  const rec = (await page.evaluate(route, [{ subsystem: 'drive', amps: 10 }])) as Rec;
  expect(rec.outcome.code).toBe('BROWNOUT');
  expect(rec.outcome.data).toBeUndefined();
  const detail = (rec.outcome as { detail?: string }).detail ?? '';
  expect(detail).toContain('life_support');
  expect(detail).toContain('18');
});

test('duplicate subsystems are rejected', async ({ page }) => {
  const rec = (await page.evaluate(route, [
    { subsystem: 'lights', amps: 4 }, { subsystem: 'lights', amps: 4 },
  ])) as Rec;
  expect(rec.outcome.code).toBe('DUPLICATE_SUBSYSTEM');
});

test('valid routing pops fuses; seating them all + stability completes the chapter', async ({ page }) => {
  const rec = (await page.evaluate(route, [
    { subsystem: 'life_support', amps: 18 }, { subsystem: 'comms', amps: 8 },
    { subsystem: 'sensors', amps: 6 }, { subsystem: 'lights', amps: 4 },
    { subsystem: 'drive', amps: 14 },
  ])) as Rec;
  expect(rec.outcome.ok).toBe(true);
  const fuses = page.locator('[data-fuse]');
  await expect(fuses).toHaveCount(5);
  for (const id of ['life_support', 'comms', 'sensors', 'lights', 'drive']) {
    const fuse = page.locator(`[data-fuse="${id}"]`);
    const box = (await fuse.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(250); // fast fuseSeatMs = 150
    await page.mouse.up();
  }
  await expect.poll(async () => page.evaluate(() => window.halcyonSim.getState().chapterDone[3]), { timeout: 5000 }).toBe(true);
  const routed = await page.evaluate(() => window.halcyonSim.getState().flags['power.routed']);
  expect(routed).toBe(true);
});
```

- [ ] **Step 2: Commit the failing spec**

```bash
git checkout -b task/09-ch3
git add tests/e2e/ch3.spec.ts
git commit -m "test: ch3 power — budget, staged brownouts, fuse seating

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Implement chapter 3**

Add to `T` in `src/game/timings.ts`: `fuseSeatMs: FAST ? 150 : 600,`

`src/game/chapters/ch3_power.ts`:
```ts
import type { Chapter, ChapterCtx } from './types';
import { FLAGS } from './types';
import type { ToolDef } from '../../webmcp/types';
import type { Subsystem } from '../store';
import { T } from '../timings';
import { el } from '../../ui/dom';

const BUDGET = 60;
const MIN_ORDER: [Subsystem, number][] = [['life_support', 18], ['comms', 8], ['sensors', 6], ['lights', 4]];
const ALL: Subsystem[] = ['life_support', 'comms', 'drive', 'sensors', 'lights', 'heaters'];

let seated = new Set<Subsystem>();
let pending: Partial<Record<Subsystem, number>> | null = null;
let stableTimer: number | null = null;
let fuseTray: HTMLElement | null = null;
let cleanup: (() => void)[] = [];

function clearStableTimer(): void { if (stableTimer !== null) { clearTimeout(stableTimer); stableTimer = null; } }

function renderFuses(ctx: ChapterCtx): void {
  if (!fuseTray || !pending) return;
  fuseTray.replaceChildren();
  const powered = ALL.filter((s) => (pending![s] ?? 0) > 0);
  for (const sub of powered) {
    const fuse = el('button', { class: 'fuse', 'data-fuse': sub }, `${sub} ✕`);
    let holdTimer: number | null = null;
    const down = () => {
      holdTimer = window.setTimeout(() => {
        seated.add(sub);
        fuse.textContent = `${sub} ●`;
        fuse.classList.add('fuse-seated');
        ctx.audio.click();
        ctx.recorder.addHuman(`fuse re-seated: ${sub}`);
        if (powered.every((s) => seated.has(s))) startStability(ctx);
      }, T.fuseSeatMs);
    };
    const up = () => { if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; } };
    fuse.addEventListener('pointerdown', down);
    fuse.addEventListener('pointerup', up);
    fuse.addEventListener('pointerleave', up);
    cleanup.push(() => { fuse.removeEventListener('pointerdown', down); fuse.removeEventListener('pointerup', up); fuse.removeEventListener('pointerleave', up); });
    fuseTray.append(fuse);
  }
}

function startStability(ctx: ChapterCtx): void {
  ctx.speaker.say(`All fuses seated. Holding the bus steady… do not sneeze.`, 'dry');
  stableTimer = window.setTimeout(() => {
    ctx.store.update((s) => {
      for (const sub of ALL) s.power[sub] = pending?.[sub] ?? 0;
      s.flags[FLAGS.powerRouted] = true;
    });
    ctx.speaker.say('Power grid stable. Life support at full. Breathe easy, crew.', 'calm');
    ctx.complete();
  }, T.powerStableMs);
}

export const ch3: Chapter = {
  id: 3,
  title: 'Power',
  tools(ctx: ChapterCtx): ToolDef[] {
    return [
      {
        name: 'read_power_telemetry',
        description: 'Read the power bus: total budget in amps and the current draw per subsystem. Minimum requirements per subsystem are NOT documented — the bus reports a brownout when a route leaves one short.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        readOnly: true,
        execute: () => ({ ok: true, data: { budget_amps: BUDGET, draw: ctx.store.get().power, routed: ctx.store.get().flags[FLAGS.powerRouted] === true } }),
      },
      {
        name: 'route_power',
        description: 'Route amps to subsystems within the 60A budget. Omitted subsystems get 0A. A valid route pops the physical fuses; your crewmate must re-seat every powered fuse, then the bus must hold stable. Re-routing mid-hold pops the fuses again.',
        inputSchema: {
          type: 'object', required: ['allocations'], additionalProperties: false,
          properties: {
            allocations: {
              type: 'array', minItems: 1, maxItems: 6,
              items: {
                type: 'object', required: ['subsystem', 'amps'], additionalProperties: false,
                properties: {
                  subsystem: { type: 'string', enum: [...ALL] },
                  amps: { type: 'integer', minimum: 0, maximum: 40 },
                },
              },
            },
          },
        },
        execute: (args) => {
          const allocations = args.allocations as { subsystem: Subsystem; amps: number }[];
          const seen = new Set<Subsystem>();
          for (const a of allocations) {
            if (seen.has(a.subsystem))
              return { ok: false, code: 'DUPLICATE_SUBSYSTEM', detail: `${a.subsystem} appears twice.`, hint: 'List each subsystem at most once.' };
            seen.add(a.subsystem);
          }
          const total = allocations.reduce((n, a) => n + a.amps, 0);
          if (total > BUDGET)
            return { ok: false, code: 'OVER_BUDGET', detail: `Requested ${total}A of a ${BUDGET}A budget.`, hint: 'Reduce the total to 60A or less.' };
          const get = (s: Subsystem) => allocations.find((a) => a.subsystem === s)?.amps ?? 0;
          for (const [sub, min] of MIN_ORDER)
            if (get(sub) < min)
              return { ok: false, code: 'BROWNOUT', detail: `${sub} browns out below ${min}A (got ${get(sub)}A).`, hint: `Give ${sub} at least ${min}A and route again. Other subsystems may have minimums too.` };
          clearStableTimer();
          seated = new Set();
          pending = Object.fromEntries(allocations.map((a) => [a.subsystem, a.amps])) as Partial<Record<Subsystem, number>>;
          renderFuses(ctx);
          ctx.audio.alarm();
          ctx.recorder.addHuman('fuses popped — awaiting re-seat');
          return { ok: true, data: { accepted: pending, next: 'Crew must hold each popped fuse until it clicks, then the bus holds stable.' } };
        },
      },
    ];
  },
  mount(ctx: ChapterCtx): void {
    seated = new Set(); pending = null; stableTimer = null;
    fuseTray = el('div', { class: 'fuse-tray', 'data-testid': 'fuse-tray' });
    ctx.stage.append(
      el('p', { class: 'chapter-brief' }, 'The bus tripped everything. HALCYON routes the amps; you hold each popped fuse until it clicks home. If it re-routes, they pop again.'),
      fuseTray,
    );
    ctx.speaker.say('I can route power but the fuses are physical, crew. I route, you seat. Life support first.', 'calm');
  },
  unmount(): void {
    clearStableTimer();
    for (const fn of cleanup) fn();
    cleanup = []; fuseTray = null; pending = null;
  },
};
```

Register in `src/game/chapters/index.ts`: import `ch3`, add `3: ch3` to `CHAPTERS`.

Append to `src/styles.css`:
```css
.fuse-tray { display:flex; gap:10px; flex-wrap:wrap; margin-top:14px; }
.fuse { background:var(--panel); color:var(--err); border:1px solid var(--err); padding:10px 14px; cursor:pointer; font:inherit; user-select:none; touch-action:none; }
.fuse-seated { color:var(--fg); border-color:var(--fg); }
```

- [ ] **Step 4: Local typecheck** — Run: `npm run typecheck`. Expected: exit 0.

- [ ] **Step 5: Commit, push, PR, verify CI, merge**

```bash
git add -A
git commit -m "feat: ch3 power — schema routing, staged brownouts, fuse holds

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin task/09-ch3
gh pr create --title "feat: chapter 3 (Power)" --body "Task 9. Schema-driven self-correction: budget + hidden minimums revealed one BROWNOUT at a time; human seats popped fuses; stability hold completes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch --interval 20
gh pr merge --squash --delete-branch
```
Expected: CI green, merged.

---

### Task 10: Chapter 4 — "Antenna"

**Files:**
- Create: `src/game/chapters/ch4_antenna.ts`
- Modify: `src/game/chapters/index.ts` (register ch4)
- Test: `tests/e2e/ch4.spec.ts`

**Interfaces:**
- Consumes: `Chapter/ChapterCtx/FLAGS`, `T`, `el`, `AudioEngine.setStatic/stopStatic/chime`.
- Produces: `CHAPTERS[4]`. Sets `flags['comms.online']=true` at dish lock and `flags['comms.jump_vector']={x:0.42,y:-1.07,z:3.14}` at decode. Tools at mount: `read_signal_meter` (read-only). Tools ADDED at lock (dynamic registration): `send_distress`, `tune_decoder`, `decode_reply`. Constants: target az 137 / el 42 (pad maps 0–180 az, 0–90 el), lock tolerance 4°, decoder target offset −18 kHz, decode threshold quality ≥ 0.95.

- [ ] **Step 1: Write the failing e2e spec**

`tests/e2e/ch4.spec.ts`:
```ts
import { test, expect, type Page } from '@playwright/test';

type Rec = { outcome: { ok: boolean; code?: string; data?: Record<string, unknown> } };

async function alignDish(page: Page) {
  const pad = (await page.getByTestId('dish-pad').boundingBox())!;
  const knob = (await page.getByTestId('dish-knob').boundingBox())!;
  // pad maps x∈[0,width]→az 0..180, y∈[0,height]→el 0..90; target az137 el42
  const tx = pad.x + (137 / 180) * pad.width;
  const ty = pad.y + (42 / 90) * pad.height;
  await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(800); // fast lockHoldMs = 500
}

test.beforeEach(async ({ page }) => { await page.goto('/?fast=1&sim=1&ch=4'); });

test('comms tools are absent before lock and appear after (dynamic registration)', async ({ page }) => {
  let tools = await page.evaluate(() => window.halcyonSim.listTools());
  expect(tools).not.toContain('send_distress');
  await alignDish(page);
  await expect.poll(async () => page.evaluate(() => window.halcyonSim.listTools())).toContain('send_distress');
  tools = await page.evaluate(() => window.halcyonSim.listTools());
  expect(tools).toContain('tune_decoder');
  expect(tools).toContain('decode_reply');
});

test('decode before any reply coaches NO_REPLY_YET; tune loop reaches the vector', async ({ page }) => {
  await alignDish(page);
  await expect.poll(async () => page.evaluate(() => window.halcyonSim.listTools())).toContain('decode_reply');
  let rec = (await page.evaluate(([n, a]) => window.halcyonSim.invoke(n as string, a), ['decode_reply', {}])) as Rec;
  expect(rec.outcome.code).toBe('NO_REPLY_YET');
  rec = (await page.evaluate(([n, a]) => window.halcyonSim.invoke(n as string, a), ['send_distress', { message: 'ISV Halcyon requesting vector home.' }])) as Rec;
  expect(rec.outcome.ok).toBe(true);
  await page.waitForTimeout(700); // fast replyDelayMs = 500
  rec = (await page.evaluate(([n, a]) => window.halcyonSim.invoke(n as string, a), ['decode_reply', {}])) as Rec;
  expect(rec.outcome.ok).toBe(true);
  let quality = (rec.outcome.data as { checksum_quality: number }).checksum_quality;
  expect(quality).toBeLessThan(0.95);
  rec = (await page.evaluate(([n, a]) => window.halcyonSim.invoke(n as string, a), ['tune_decoder', { offset_khz: -18 }])) as Rec;
  quality = (rec.outcome.data as { checksum_quality: number }).checksum_quality;
  expect(quality).toBeGreaterThanOrEqual(0.95);
  rec = (await page.evaluate(([n, a]) => window.halcyonSim.invoke(n as string, a), ['decode_reply', {}])) as Rec;
  const data = rec.outcome.data as { decoded: { jump_vector: { x: number } } };
  expect(data.decoded.jump_vector.x).toBeCloseTo(0.42);
  await expect.poll(async () => page.evaluate(() => window.halcyonSim.getState().chapterDone[4])).toBe(true);
  const vec = await page.evaluate(() => window.halcyonSim.getState().flags['comms.jump_vector']);
  expect(vec).toEqual({ x: 0.42, y: -1.07, z: 3.14 });
});

test('send_distress before lock coaches COMMS_OFFLINE', async ({ page }) => {
  const rec = (await page.evaluate(([n, a]) => window.halcyonSim.invoke(n as string, a), ['send_distress', { message: 'hello' }])) as Rec;
  expect(rec.outcome.code).toBe('UNKNOWN_TOOL'); // not registered yet — the registry itself teaches
});
```

- [ ] **Step 2: Commit the failing spec**

```bash
git checkout -b task/10-ch4
git add tests/e2e/ch4.spec.ts
git commit -m "test: ch4 antenna — audio-guided lock gates dynamic comms tools

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Implement chapter 4**

`src/game/chapters/ch4_antenna.ts`:
```ts
import type { Chapter, ChapterCtx } from './types';
import { FLAGS } from './types';
import type { ToolDef } from '../../webmcp/types';
import { T } from '../timings';
import { el } from '../../ui/dom';

const TARGET = { az: 137, el: 42 };
const LOCK_TOL = 4;
const DECODE_TARGET_KHZ = -18;
const JUMP_VECTOR = { x: 0.42, y: -1.07, z: 3.14 };

let pos = { az: 20, el: 70 };
let locked = false;
let lockSince: number | null = null;
let replyAt: number | null = null;
let offsetKhz = 0;
let watch: number | null = null;
let cleanup: (() => void)[] = [];

function err(): number { return Math.hypot(pos.az - TARGET.az, pos.el - TARGET.el); }
function quality(): number { return Math.max(0, 1 - Math.abs(offsetKhz - DECODE_TARGET_KHZ) / 50); }
function garble(text: string, q: number): string {
  const noise = '#@%&$!?~^*';
  return [...text].map((c, i) => (c === ' ' || ((i * 7919) % 100) / 100 < q ? c : noise[i % noise.length])).join('');
}

function commsTools(ctx: ChapterCtx): ToolDef[] {
  return [
    {
      name: 'send_distress',
      description: 'Transmit a distress call on the locked antenna. A rescue buoy may answer after a short delay; then decode the reply.',
      inputSchema: { type: 'object', required: ['message'], additionalProperties: false, properties: { message: { type: 'string', minLength: 1, maxLength: 120 } } },
      rateLimitMs: 2000,
      execute: (args) => {
        replyAt = Date.now() + T.replyDelayMs;
        ctx.speaker.say(`Transmitting: "${String(args.message)}"`, 'calm');
        setTimeout(() => { ctx.audio.chime(); ctx.speaker.say('…incoming reply. It is garbled — tune the decoder.', 'urgent'); }, T.replyDelayMs);
        return { ok: true, data: { sent: true, next: 'Wait for the reply, then call decode_reply. Use tune_decoder to raise checksum_quality above 0.95.' } };
      },
    },
    {
      name: 'tune_decoder',
      description: 'Set the decoder frequency offset in kHz (-50..50). Returns checksum_quality (0..1). Iterate toward 1.0 — the reply decodes at 0.95 or better.',
      inputSchema: { type: 'object', required: ['offset_khz'], additionalProperties: false, properties: { offset_khz: { type: 'integer', minimum: -50, maximum: 50 } } },
      execute: (args) => {
        offsetKhz = args.offset_khz as number;
        return { ok: true, data: { offset_khz: offsetKhz, checksum_quality: Number(quality().toFixed(2)) } };
      },
    },
    {
      name: 'decode_reply',
      description: 'Decode the last received transmission at the current decoder offset. Below 0.95 checksum_quality the text is garbled.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      readOnly: true,
      execute: () => {
        if (replyAt === null || Date.now() < replyAt)
          return { ok: false, code: 'NO_REPLY_YET', detail: 'The receiver holds no transmission.', hint: 'Call send_distress first, then wait a moment for the buoy to answer.' };
        const q = quality();
        const message = `RESCUE BUOY 7: vector home locked x ${JUMP_VECTOR.x} y ${JUMP_VECTOR.y} z ${JUMP_VECTOR.z}. Godspeed, Halcyon.`;
        if (q < 0.95)
          return { ok: true, data: { checksum_quality: Number(q.toFixed(2)), text: garble(message, q), hint: 'Adjust tune_decoder and decode again.' } };
        ctx.store.update((s) => { s.flags[FLAGS.jumpVector] = { ...JUMP_VECTOR }; });
        ctx.speaker.say('Reply decoded. We have a vector home, crew. Write it down — I will need it for the burn.', 'calm');
        ctx.complete();
        return { ok: true, data: { checksum_quality: Number(q.toFixed(2)), decoded: { message, jump_vector: { ...JUMP_VECTOR } } } };
      },
    },
  ];
}

function lockOn(ctx: ChapterCtx): void {
  locked = true;
  ctx.audio.stopStatic();
  ctx.audio.chime();
  ctx.store.update((s) => { s.flags[FLAGS.commsOnline] = true; });
  ctx.registry.addTools(commsTools(ctx));
  ctx.recorder.addHuman('antenna locked — comms tools registered mid-page');
  ctx.speaker.say('Lock! New comms tools just came online for me: send_distress, tune_decoder, decode_reply.', 'urgent');
}

export const ch4: Chapter = {
  id: 4,
  title: 'Antenna',
  tools(ctx: ChapterCtx): ToolDef[] {
    return [{
      name: 'read_signal_meter',
      description: 'Read the antenna signal meter. Coarse: reports band strength only. The fine alignment is audible on the bridge — the crew can hear the static pitch rise near lock; you cannot.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      readOnly: true,
      execute: () => {
        const e = err();
        return { ok: true, data: { band: e < LOCK_TOL ? 'LOCK' : e < 25 ? 'NEAR' : 'FAR', locked, comms_online: ctx.store.get().flags[FLAGS.commsOnline] === true } };
      },
    }];
  },
  mount(ctx: ChapterCtx): void {
    pos = { az: 20, el: 70 }; locked = false; lockSince = null; replyAt = null; offsetKhz = 0;
    const readout = el('div', { class: 'dish-readout', 'data-testid': 'dish-readout' });
    const knob = el('div', { class: 'dish-knob', 'data-testid': 'dish-knob' });
    const pad = el('div', { class: 'dish-pad', 'data-testid': 'dish-pad' }, knob);
    const place = () => {
      knob.style.left = `${(pos.az / 180) * 100}%`;
      knob.style.top = `${(pos.el / 90) * 100}%`;
      readout.textContent = `AZ ~${Math.round(pos.az / 10) * 10}° EL ~${Math.round(pos.el / 10) * 10}° (coarse)`;
    };
    place();
    let dragging = false;
    const down = (e: PointerEvent) => { dragging = true; knob.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!dragging || locked) return;
      const r = pad.getBoundingClientRect();
      pos.az = Math.max(0, Math.min(180, ((e.clientX - r.left) / r.width) * 180));
      pos.el = Math.max(0, Math.min(90, ((e.clientY - r.top) / r.height) * 90));
      place();
    };
    const up = () => { dragging = false; };
    knob.addEventListener('pointerdown', down);
    knob.addEventListener('pointermove', move);
    knob.addEventListener('pointerup', up);
    cleanup.push(() => { knob.removeEventListener('pointerdown', down); knob.removeEventListener('pointermove', move); knob.removeEventListener('pointerup', up); });
    watch = window.setInterval(() => {
      if (locked) return;
      const e = err();
      ctx.audio.setStatic(Math.min(1, e / 60), 200 + Math.max(0, 1 - e / 120) * 900);
      if (e < LOCK_TOL) {
        if (lockSince === null) lockSince = Date.now();
        else if (Date.now() - lockSince >= T.lockHoldMs) lockOn(ctx);
      } else lockSince = null;
    }, 100);
    cleanup.push(() => { if (watch !== null) clearInterval(watch); ctx.audio.stopStatic(); });
    ctx.stage.append(
      el('p', { class: 'chapter-brief' }, 'The dish moves by hand. The bearing readout is shot — coarse tens only. Listen: the static pitch climbs as you close in. Hold the sweet spot.'),
      pad, readout,
    );
    ctx.speaker.say('My signal meter only says FAR, NEAR, LOCK. Your ears are the fine instrument now, crew. Sweep slowly.', 'calm');
  },
  unmount(): void { for (const fn of cleanup) fn(); cleanup = []; },
};
```

Register in `src/game/chapters/index.ts`: import `ch4`, add `4: ch4`.

Append to `src/styles.css`:
```css
.dish-pad { position:relative; width:min(360px, 90%); height:180px; border:1px solid var(--dim); background:var(--panel); margin-top:14px; touch-action:none; }
.dish-knob { position:absolute; width:18px; height:18px; margin:-9px; border-radius:50%; background:var(--warn); cursor:grab; touch-action:none; }
.dish-readout { color:var(--dim); margin-top:6px; }
```

- [ ] **Step 4: Local typecheck** — Run: `npm run typecheck`. Expected: exit 0.

- [ ] **Step 5: Commit, push, PR, verify CI, merge**

```bash
git add -A
git commit -m "feat: ch4 antenna — audio-guided alignment gates dynamic comms tools

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin task/10-ch4
gh pr create --title "feat: chapter 4 (Antenna)" --body "Task 10. Human-only audio channel for fine alignment; lock registers send_distress/tune_decoder/decode_reply mid-page; checksum feedback loop; decoded jump vector feeds ch6.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch --interval 20
gh pr merge --squash --delete-branch
```
Expected: CI green, merged.

---

### Task 11: Chapter 5 — "Two-Man Rule"

**Files:**
- Create: `src/game/chapters/ch5_twoman.ts`
- Modify: `src/game/chapters/index.ts` (register ch5)
- Test: `tests/e2e/ch5.spec.ts`

**Interfaces:**
- Consumes: `Chapter/ChapterCtx/FLAGS`, `T`, `el`.
- Produces: `CHAPTERS[5]`. Sets `flags['drive.purged']=true` on success. Tools: `read_gauge` (read-only), `arm_purge`. Constants: pressure(t) = 55 + 35·sin(2π·(t−t₀)/period), period `FAST ? 3000 : 12000` ms (chapter-local constant), safe band [30, 55]. Human: hold the LEFT handle with the pointer AND the RIGHT handle with the Space key, both continuously for `T.holdMs` while armed.

- [ ] **Step 1: Write the failing e2e spec**

`tests/e2e/ch5.spec.ts`:
```ts
import { test, expect, type Page } from '@playwright/test';

type Rec = { outcome: { ok: boolean; code?: string; data?: { pressure: number; armed: boolean } } };
const gauge = (page: Page) => page.evaluate(() => window.halcyonSim.invoke('read_gauge', {})) as Promise<Rec>;
const inBand = (p: number) => p >= 30 && p <= 55;

async function waitForBand(page: Page, want: boolean): Promise<void> {
  await expect.poll(async () => { const r = await gauge(page); return inBand((r.outcome.data as { pressure: number }).pressure) === want; }, { timeout: 10000 }).toBe(true);
}

test.beforeEach(async ({ page }) => { await page.goto('/?fast=1&sim=1&ch=5'); });

test('arming outside the band coaches PRESSURE_OUT_OF_BAND', async ({ page }) => {
  await waitForBand(page, false);
  const rec = (await page.evaluate(() => window.halcyonSim.invoke('arm_purge', {}))) as Rec;
  expect(rec.outcome.code).toBe('PRESSURE_OUT_OF_BAND');
});

test('one handle alone never purges; both handles inside the armed window do', async ({ page }) => {
  await waitForBand(page, true);
  const armed = (await page.evaluate(() => window.halcyonSim.invoke('arm_purge', {}))) as Rec;
  expect(armed.outcome.ok).toBe(true);
  const left = (await page.getByTestId('vent-left').boundingBox())!;
  await page.mouse.move(left.x + left.width / 2, left.y + left.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900); // > fast holdMs 600, but only ONE handle
  expect(await page.evaluate(() => window.halcyonSim.getState().chapterDone[5])).toBe(false);
  await page.keyboard.down('Space'); // second handle joins
  await page.waitForTimeout(900);
  await page.keyboard.up('Space');
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => window.halcyonSim.getState().chapterDone[5])).toBe(true);
  expect(await page.evaluate(() => window.halcyonSim.getState().flags['drive.purged'])).toBe(true);
});

test('the armed window expires and disarms', async ({ page }) => {
  await waitForBand(page, true);
  await page.evaluate(() => window.halcyonSim.invoke('arm_purge', {}));
  await page.waitForTimeout(4400); // fast armWindowMs = 4000
  const rec = await gauge(page);
  expect((rec.outcome.data as { armed: boolean }).armed).toBe(false);
});
```

- [ ] **Step 2: Commit the failing spec**

```bash
git checkout -b task/11-ch5
git add tests/e2e/ch5.spec.ts
git commit -m "test: ch5 two-man rule — band-gated arming + simultaneous holds

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Implement chapter 5**

`src/game/chapters/ch5_twoman.ts`:
```ts
import type { Chapter, ChapterCtx } from './types';
import { FLAGS } from './types';
import type { ToolDef } from '../../webmcp/types';
import { FAST, T } from '../timings';
import { el } from '../../ui/dom';

const PERIOD_MS = FAST ? 3000 : 12000;
const BAND: [number, number] = [30, 55];

let t0 = 0;
let armedUntil = 0;
let leftHeld = false;
let rightHeld = false;
let bothSince: number | null = null;
let watch: number | null = null;
let disarmTimer: number | null = null;
let cleanup: (() => void)[] = [];

function pressure(): number {
  return 55 + 35 * Math.sin((2 * Math.PI * (Date.now() - t0)) / PERIOD_MS);
}
function inBand(p: number): boolean { return p >= BAND[0] && p <= BAND[1]; }
function armed(): boolean { return Date.now() < armedUntil; }

export const ch5: Chapter = {
  id: 5,
  title: 'Two-Man Rule',
  tools(ctx: ChapterCtx): ToolDef[] {
    return [
      {
        name: 'read_gauge',
        description: 'Read the drive pressure gauge. The purge only arms inside the safe band, and the band comes and goes with the pressure swing. Poll this to time your arm call.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        readOnly: true,
        execute: () => ({ ok: true, data: { pressure: Number(pressure().toFixed(1)), safe_band: BAND, armed: armed(), purged: ctx.store.get().flags[FLAGS.drivePurged] === true } }),
      },
      {
        name: 'arm_purge',
        description: 'Arm the drive purge. Requires pressure inside the safe band. Arming opens a short window in which the crew must hold BOTH vent handles at the same time — a two-man rule. You time the arm; they supply the hands.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        execute: () => {
          const p = pressure();
          if (!inBand(p))
            return { ok: false, code: 'PRESSURE_OUT_OF_BAND', detail: `Pressure is ${p.toFixed(1)}; the safe band is ${BAND[0]}–${BAND[1]}.`, hint: 'Poll read_gauge and call arm_purge the moment the pressure enters the band. Warn your crew first so their hands are ready.' };
          armedUntil = Date.now() + T.armWindowMs;
          ctx.audio.alarm();
          ctx.speaker.say('ARMED. Both vent handles, crew — NOW. Hold until the ring closes.', 'urgent');
          ctx.recorder.addHuman('purge armed — two-man window open');
          if (disarmTimer !== null) clearTimeout(disarmTimer);
          disarmTimer = window.setTimeout(() => {
            if (ctx.store.get().flags[FLAGS.drivePurged] === true) return;
            ctx.speaker.say('Window closed. No shame — we time it again.', 'dry');
            ctx.recorder.addHuman('purge window expired');
          }, T.armWindowMs);
          return { ok: true, data: { armed_for_ms: T.armWindowMs, next: 'Crew must hold both handles simultaneously until the purge completes.' } };
        },
      },
    ];
  },
  mount(ctx: ChapterCtx): void {
    t0 = Date.now(); armedUntil = 0; leftHeld = false; rightHeld = false; bothSince = null;
    const ring = el('div', { class: 'hold-ring', 'data-testid': 'hold-ring' });
    const left = el('button', { class: 'vent-handle', 'data-testid': 'vent-left' }, 'VENT A — hold (pointer)');
    const right = el('div', { class: 'vent-handle vent-key', 'data-testid': 'vent-right' }, 'VENT B — hold [SPACE]');
    const lDown = () => { leftHeld = true; };
    const lUp = () => { leftHeld = false; };
    left.addEventListener('pointerdown', lDown);
    left.addEventListener('pointerup', lUp);
    left.addEventListener('pointerleave', lUp);
    const kDown = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); rightHeld = true; } };
    const kUp = (e: KeyboardEvent) => { if (e.code === 'Space') rightHeld = false; };
    window.addEventListener('keydown', kDown);
    window.addEventListener('keyup', kUp);
    cleanup.push(() => {
      left.removeEventListener('pointerdown', lDown); left.removeEventListener('pointerup', lUp); left.removeEventListener('pointerleave', lUp);
      window.removeEventListener('keydown', kDown); window.removeEventListener('keyup', kUp);
    });
    watch = window.setInterval(() => {
      const both = leftHeld && rightHeld && armed();
      left.classList.toggle('vent-armed', armed());
      right.classList.toggle('vent-armed', armed());
      if (!both) { bothSince = null; ring.style.setProperty('--pct', '0'); return; }
      if (bothSince === null) bothSince = Date.now();
      const pct = Math.min(1, (Date.now() - bothSince) / T.holdMs);
      ring.style.setProperty('--pct', String(pct));
      if (pct >= 1 && ctx.store.get().flags[FLAGS.drivePurged] !== true) {
        ctx.store.update((s) => { s.flags[FLAGS.drivePurged] = true; });
        ctx.audio.chime();
        ctx.recorder.addHuman('both handles held — drive purged');
        ctx.speaker.say('Purge complete. Textbook two-man rule, crew. The drive is clean.', 'calm');
        ctx.complete();
      }
    }, 50);
    cleanup.push(() => { if (watch !== null) clearInterval(watch); if (disarmTimer !== null) clearTimeout(disarmTimer); });
    ctx.stage.append(
      el('p', { class: 'chapter-brief' }, 'The purge needs four hands: HALCYON arms it inside a pressure window; you hold BOTH vents — one with the pointer, one with SPACE — until the ring closes.'),
      el('div', { class: 'vent-row' }, left, ring, right),
    );
    ctx.speaker.say('This valve was designed for two humans. It gets a human and a ghost with perfect timing instead. Watch my call.', 'dry');
  },
  unmount(): void { for (const fn of cleanup) fn(); cleanup = []; },
};
```

Register in `src/game/chapters/index.ts`: import `ch5`, add `5: ch5`.

Append to `src/styles.css`:
```css
.vent-row { display:flex; align-items:center; gap:24px; margin-top:16px; flex-wrap:wrap; }
.vent-handle { background:var(--panel); color:var(--fg); border:1px solid var(--dim); padding:22px 16px; font:inherit; cursor:pointer; user-select:none; touch-action:none; }
.vent-armed { border-color:var(--warn); color:var(--warn); }
.hold-ring { width:56px; height:56px; border-radius:50%; background:conic-gradient(var(--fg) calc(var(--pct,0)*360deg), var(--panel) 0); border:1px solid var(--dim); }
```

- [ ] **Step 4: Local typecheck** — Run: `npm run typecheck`. Expected: exit 0.

- [ ] **Step 5: Commit, push, PR, verify CI, merge**

```bash
git add -A
git commit -m "feat: ch5 two-man rule — band-timed arming + dual simultaneous holds

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin task/11-ch5
gh pr create --title "feat: chapter 5 (Two-Man Rule)" --body "Task 11. The WebMCP confirmation philosophy as a mechanic: agent times the arm from telemetry; human supplies simultaneous physical holds.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch --interval 20
gh pr merge --squash --delete-branch
```
Expected: CI green, merged.

---

### Task 12: Chapter 6 — "Burn" + victory replay + full-run e2e

**Files:**
- Create: `src/game/chapters/ch6_burn.ts`
- Modify: `src/game/chapters/index.ts` (register ch6), `src/game/timings.ts` (add `throttleHoldMs: FAST ? 1000 : 3000,`)
- Test: `tests/e2e/ch6.spec.ts`, `tests/e2e/fullrun.spec.ts`

**Interfaces:**
- Consumes: `Chapter/ChapterCtx/FLAGS`, `T/FAST`, `el`, `Recorder.getTimeline()`, `AudioEngine.startMetronome`.
- Produces: `CHAPTERS[6]`. Tools: `set_jump_vector`, `pressurize_injectors`, `ignite_precheck` (read-only status style but it arms state — NOT readOnly), `execute_jump`. Chapter-local constants: `TAPS_NEEDED = FAST ? 4 : 8`, `TAP_TOL_MS = FAST ? 10000 : 180`, metronome 90 bpm. Victory renders `data-testid="victory-card"` with `data-testid="replay-timeline"` entries from `recorder.getTimeline()`.

- [ ] **Step 1: Write the failing e2e specs**

`tests/e2e/ch6.spec.ts`:
```ts
import { test, expect, type Page } from '@playwright/test';

type Rec = { outcome: { ok: boolean; code?: string; data?: Record<string, unknown> } };
const call = ([n, a]: [string, unknown]) => window.halcyonSim.invoke(n, a);

async function holdFor(page: Page, testid: string, ms: number) {
  const box = (await page.getByTestId(testid).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => { await page.goto('/?fast=1&sim=1&ch=6'); });

test('wrong vector coaches VECTOR_MISMATCH; precheck names what is missing', async ({ page }) => {
  let rec = (await page.evaluate(call, ['set_jump_vector', { x: 1, y: 2, z: 3 }] as [string, unknown])) as Rec;
  expect(rec.outcome.code).toBe('VECTOR_MISMATCH');
  rec = (await page.evaluate(call, ['ignite_precheck', {}] as [string, unknown])) as Rec;
  expect(rec.outcome.code).toBe('NOT_READY');
  expect(JSON.stringify(rec.outcome)).toContain('jump_vector');
});

test('the full interleaved checklist reaches the jump and the replay', async ({ page }) => {
  let rec = (await page.evaluate(call, ['set_jump_vector', { x: 0.42, y: -1.07, z: 3.14 }] as [string, unknown])) as Rec;
  expect(rec.outcome.ok).toBe(true);
  rec = (await page.evaluate(call, ['pressurize_injectors', {}] as [string, unknown])) as Rec;
  expect(rec.outcome.ok).toBe(true);
  for (let i = 0; i < 4; i++) { await page.getByTestId('inject-tap').click(); await page.waitForTimeout(120); } // fast: any timing counts
  await holdFor(page, 'shutter-left', 300);   // fast fuseSeatMs = 150
  await holdFor(page, 'shutter-right', 300);
  rec = (await page.evaluate(call, ['ignite_precheck', {}] as [string, unknown])) as Rec;
  expect(rec.outcome.ok).toBe(true);
  await holdFor(page, 'throttle', 1400);      // fast throttleHoldMs = 1000
  rec = (await page.evaluate(call, ['execute_jump', {}] as [string, unknown])) as Rec;
  expect(rec.outcome.ok).toBe(true);
  await expect(page.getByTestId('victory-card')).toBeVisible();
  await expect(page.getByTestId('replay-timeline')).toContainText('execute_jump');
  await expect.poll(async () => page.evaluate(() => window.halcyonSim.getState().chapterDone[6])).toBe(true);
});

test('execute_jump before the checklist coaches NOT_READY', async ({ page }) => {
  const rec = (await page.evaluate(call, ['execute_jump', {}] as [string, unknown])) as Rec;
  expect(rec.outcome.code).toBe('NOT_READY');
});
```

`tests/e2e/fullrun.spec.ts` — one test that plays Chapters 1→6 back-to-back in sim mode, reusing the exact interaction blocks from ch1–ch6 specs in order (breaker drag → handshake → manifest flags+acks → power route+fuses → dish align → distress/tune/decode → gauge poll+arm+dual hold → burn checklist), asserting `chapterDone[6]` at the end. Copy the helper functions into this file verbatim (specs must stay independent). `test.setTimeout(180_000)`.

- [ ] **Step 2: Commit the failing specs**

```bash
git checkout -b task/12-ch6
git add tests/e2e/ch6.spec.ts tests/e2e/fullrun.spec.ts
git commit -m "test: ch6 burn checklist + full six-chapter co-op run

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Implement chapter 6**

Add to `T` in `src/game/timings.ts`: `throttleHoldMs: FAST ? 1000 : 3000,`

`src/game/chapters/ch6_burn.ts`:
```ts
import type { Chapter, ChapterCtx } from './types';
import { FLAGS } from './types';
import type { ToolDef } from '../../webmcp/types';
import { FAST, T } from '../timings';
import { el } from '../../ui/dom';
import type { TimelineEntry } from '../../ui/recorder';

const TAPS_NEEDED = FAST ? 4 : 8;
const TAP_TOL_MS = FAST ? 10000 : 180;
const BPM = 90;
const PERIOD = 60000 / BPM;

interface BurnState { vectorSet: boolean; pressurized: boolean; taps: number; shuttersLeft: boolean; shuttersRight: boolean; precheckGo: boolean; throttleDone: boolean }
let burn: BurnState = reset();
function reset(): BurnState { return { vectorSet: false, pressurized: false, taps: 0, shuttersLeft: false, shuttersRight: false, precheckGo: false, throttleDone: false }; }

let countdownUntil = 0;
let metronomeStop: (() => void) | null = null;
let metroStartAt = 0;
let cleanup: (() => void)[] = [];

function missing(ctx: ChapterCtx): string[] {
  const out: string[] = [];
  if (!burn.vectorSet) out.push('jump_vector (set_jump_vector with the decoded vector)');
  if (!burn.pressurized) out.push('injectors_pressurized (pressurize_injectors)');
  if (burn.taps < TAPS_NEEDED) out.push(`injectors_primed (crew: ${burn.taps}/${TAPS_NEEDED} on-beat taps)`);
  if (!burn.shuttersLeft || !burn.shuttersRight) out.push('blast_shutters (crew: hold each shutter until it latches)');
  if (ctx.store.get().flags[FLAGS.drivePurged] !== true) out.push('drive_purge (chapter 5)');
  if (ctx.store.get().flags[FLAGS.powerRouted] !== true) out.push('power_routing (chapter 3)');
  return out;
}

function startCountdownOnce(ctx: ChapterCtx, bar: HTMLElement): void {
  if (countdownUntil !== 0) return;
  countdownUntil = Date.now() + T.burnCountdownMs;
  const tick = window.setInterval(() => {
    const left = countdownUntil - Date.now();
    bar.style.setProperty('--pct', String(Math.max(0, left / T.burnCountdownMs)));
    if (left <= 0) {
      burn = reset();
      countdownUntil = 0;
      clearInterval(tick);
      ctx.audio.alarm();
      ctx.recorder.addHuman('burn window expired — checklist reset');
      ctx.speaker.say('Window closed. Deep breath. Same dance, from the top — we have fuel for as many tries as we need.', 'calm');
    }
  }, 200);
  cleanup.push(() => clearInterval(tick));
}

export const ch6: Chapter = {
  id: 6,
  title: 'Burn',
  tools(ctx: ChapterCtx): ToolDef[] {
    const num = { type: 'number', minimum: -10, maximum: 10 };
    return [
      {
        name: 'set_jump_vector',
        description: 'Load the jump vector into the nav computer. Must match the vector decoded from the rescue buoy (see get_ship_state.jump_vector). Starts the burn countdown.',
        inputSchema: { type: 'object', required: ['x', 'y', 'z'], additionalProperties: false, properties: { x: num, y: num, z: num } },
        execute: (args) => {
          const want = ctx.store.get().flags[FLAGS.jumpVector] as { x: number; y: number; z: number } | undefined;
          if (!want)
            return { ok: false, code: 'NO_VECTOR_KNOWN', detail: 'No decoded vector on file.', hint: 'Chapter 4 decodes the vector. Check get_ship_state.' };
          const close = (a: number, b: number) => Math.abs(a - b) <= 0.011;
          if (!close(args.x as number, want.x) || !close(args.y as number, want.y) || !close(args.z as number, want.z))
            return { ok: false, code: 'VECTOR_MISMATCH', detail: 'That vector does not match the buoy reply.', hint: 'Use the exact jump_vector from decode_reply / get_ship_state.' };
          burn.vectorSet = true;
          return { ok: true, data: { vector_locked: true, next: 'pressurize_injectors' } };
        },
      },
      {
        name: 'pressurize_injectors',
        description: 'Pressurize the drive injectors. Requires the jump vector to be locked first.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        execute: () => {
          if (!burn.vectorSet)
            return { ok: false, code: 'SEQUENCE_ORDER', detail: 'The nav computer has no vector.', hint: 'Call set_jump_vector first.' };
          burn.pressurized = true;
          ctx.speaker.say('Injectors pressurized. Crew: prime them on my beat, then close both blast shutters.', 'urgent');
          return { ok: true, data: { pressurized: true, next: 'Crew primes injectors on the metronome, closes both shutters; then call ignite_precheck.' } };
        },
      },
      {
        name: 'ignite_precheck',
        description: 'Run the pre-ignition checklist. Returns GO, or the exact list of missing items. Poll this to coordinate the crew.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        execute: () => {
          const miss = missing(ctx);
          if (miss.length > 0)
            return { ok: false, code: 'NOT_READY', detail: `Missing: ${miss.join('; ')}`, hint: 'Clear every item, then call ignite_precheck again.' };
          burn.precheckGo = true;
          ctx.speaker.say('Precheck GO. Crew: throttle up and HOLD through the shake. Then I light it.', 'urgent');
          return { ok: true, data: { go: true, next: 'Crew holds the throttle through the wobble; then call execute_jump.' } };
        },
      },
      {
        name: 'execute_jump',
        description: 'Light the drive and jump home. Requires a GO precheck and the crew throttle hold to be complete.',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} },
        execute: () => {
          if (!burn.precheckGo || !burn.throttleDone) {
            const extra = burn.precheckGo ? 'crew throttle hold' : 'ignite_precheck GO';
            return { ok: false, code: 'NOT_READY', detail: `Waiting on: ${extra}.`, hint: 'Finish the checklist in order, then jump.' };
          }
          ctx.audio.chime();
          ctx.recorder.addHuman('JUMP — ISV Halcyon away');
          showVictory(ctx);
          ctx.complete();
          return { ok: true, data: { jumped: true, message: 'See you on the other side, crew.' } };
        },
      },
    ];
  },
  mount(ctx: ChapterCtx): void {
    burn = reset(); countdownUntil = 0; metroStartAt = 0;
    const bar = el('div', { class: 'burn-bar', 'data-testid': 'burn-bar' });
    const tap = el('button', { class: 'inject-tap', 'data-testid': 'inject-tap' }, `PRIME 0/${TAPS_NEEDED}`);
    const onTap = () => {
      startCountdownOnce(ctx, bar);
      if (!burn.pressurized || burn.taps >= TAPS_NEEDED) return;
      if (metroStartAt === 0) {
        metroStartAt = Date.now();
        metronomeStop = ctx.audio.startMetronome(BPM, () => { tap.classList.add('beat'); setTimeout(() => tap.classList.remove('beat'), 120); });
      }
      const phase = (Date.now() - metroStartAt) % PERIOD;
      if (phase <= TAP_TOL_MS || phase >= PERIOD - TAP_TOL_MS) {
        burn.taps++;
        ctx.audio.click();
        tap.textContent = `PRIME ${burn.taps}/${TAPS_NEEDED}`;
        if (burn.taps >= TAPS_NEEDED) { metronomeStop?.(); ctx.recorder.addHuman('injectors primed on the beat'); }
      }
    };
    tap.addEventListener('click', onTap);
    cleanup.push(() => tap.removeEventListener('click', onTap));
    const mkShutter = (side: 'left' | 'right') => {
      const b = el('button', { class: 'vent-handle', 'data-testid': `shutter-${side}` }, `SHUTTER ${side.toUpperCase()} — hold`);
      let t: number | null = null;
      const down = () => { startCountdownOnce(ctx, bar); t = window.setTimeout(() => {
        if (side === 'left') burn.shuttersLeft = true; else burn.shuttersRight = true;
        b.classList.add('fuse-seated');
        ctx.audio.click();
        ctx.recorder.addHuman(`blast shutter ${side} latched`);
      }, T.fuseSeatMs); };
      const up = () => { if (t !== null) { clearTimeout(t); t = null; } };
      b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up);
      cleanup.push(() => { b.removeEventListener('pointerdown', down); b.removeEventListener('pointerup', up); b.removeEventListener('pointerleave', up); });
      return b;
    };
    const throttle = el('button', { class: 'vent-handle throttle', 'data-testid': 'throttle' }, 'THROTTLE — hold through the shake');
    let thT: number | null = null;
    const thDown = () => { startCountdownOnce(ctx, bar); throttle.classList.add('shaking'); thT = window.setTimeout(() => {
      burn.throttleDone = true;
      throttle.classList.remove('shaking');
      throttle.classList.add('fuse-seated');
      ctx.audio.chime();
      ctx.recorder.addHuman('throttle held through the wobble');
    }, T.throttleHoldMs); };
    const thUp = () => { throttle.classList.remove('shaking'); if (thT !== null && !burn.throttleDone) { clearTimeout(thT); thT = null; } };
    throttle.addEventListener('pointerdown', thDown); throttle.addEventListener('pointerup', thUp); throttle.addEventListener('pointerleave', thUp);
    cleanup.push(() => { throttle.removeEventListener('pointerdown', thDown); throttle.removeEventListener('pointerup', thUp); throttle.removeEventListener('pointerleave', thUp); });
    ctx.stage.append(
      el('p', { class: 'chapter-brief' }, 'The last dance, interleaved: HALCYON loads the vector and pressurizes; you prime on the beat and latch both shutters; it prechecks; you hold the throttle; it lights the drive.'),
      bar,
      el('div', { class: 'vent-row' }, tap, mkShutter('left'), mkShutter('right'), throttle),
    );
    ctx.speaker.say('Final checklist, crew. I call my steps, you call yours. Nobody rushes; the window is generous and so am I.', 'calm');
  },
  unmount(): void { metronomeStop?.(); metronomeStop = null; for (const fn of cleanup) fn(); cleanup = []; },
};

function showVictory(ctx: ChapterCtx): void {
  const list = el('ol', { class: 'replay', 'data-testid': 'replay-timeline' });
  for (const e of ctx.recorder.getTimeline() as TimelineEntry[])
    list.append(el('li', { class: e.kind === 'human' ? 'rec-human' : 'rec-tool' }, `${e.kind === 'human' ? 'CREW' : 'HALCYON'} — ${e.label}`));
  ctx.stage.replaceChildren(
    el('div', { class: 'victory', 'data-testid': 'victory-card' },
      el('h2', {}, 'JUMP COMPLETE'),
      el('p', {}, 'Neither of you could have done that alone. That was the point.'),
      el('p', { class: 'victory-sign' }, 'Signed, your crew: you & HALCYON'),
      el('h3', {}, 'Flight recorder — how you did it together'),
      list,
    ),
  );
}
```

Register in `src/game/chapters/index.ts` (final state of the file):
```ts
import type { ChapterId } from '../../webmcp/types';
import type { Chapter } from './types';
import { ch1 } from './ch1_contact';
import { ch2 } from './ch2_manifest';
import { ch3 } from './ch3_power';
import { ch4 } from './ch4_antenna';
import { ch5 } from './ch5_twoman';
import { ch6 } from './ch6_burn';
export const CHAPTERS: Partial<Record<ChapterId, Chapter>> = { 1: ch1, 2: ch2, 3: ch3, 4: ch4, 5: ch5, 6: ch6 };
```

Append to `src/styles.css`:
```css
.burn-bar { height:8px; background:linear-gradient(90deg, var(--warn) calc(var(--pct,1)*100%), var(--panel) 0); border:1px solid var(--dim); margin:10px 0; }
.inject-tap { background:var(--panel); color:var(--fg); border:1px solid var(--dim); padding:22px 16px; font:inherit; cursor:pointer; }
.inject-tap.beat { border-color:var(--fg); box-shadow:0 0 12px var(--dim); }
.throttle.shaking { animation: hatchshake 0.12s linear infinite; }
.victory { border:1px solid var(--fg); padding:20px; max-width:720px; }
.victory-sign { color:var(--warn); }
.replay { font-size:12px; max-height:280px; overflow:auto; }
```

- [ ] **Step 4: Local typecheck** — Run: `npm run typecheck`. Expected: exit 0.

- [ ] **Step 5: Commit, push, PR, verify CI, merge**

```bash
git add -A
git commit -m "feat: ch6 burn — interleaved launch checklist, countdown, victory replay

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin task/12-ch6
gh pr create --title "feat: chapter 6 (Burn) + full-run e2e" --body "Task 12. Seven interleaved steps under a soft countdown; NOT_READY names exactly what is missing; victory replays the whole cooperation from the flight recorder.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch --interval 20
gh pr merge --squash --delete-branch
```
Expected: CI green (ch6 + fullrun + all prior suites), merged.

---

### Task 13: Polish pass + README

**Files:**
- Modify: `src/styles.css` (CRT overlay + typography), `index.html` (meta/OG + favicon), `src/ui/gate.ts` (judge hint line), `README.md` (full rewrite)

**Interfaces:**
- Consumes: everything shipped.
- Produces: the public face. No new code interfaces.

- [ ] **Step 1: Visual polish**

Append to `src/styles.css`:
```css
body::after { content:""; position:fixed; inset:0; pointer-events:none; z-index:50;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,0.14) 0 1px, transparent 1px 3px); }
h1, h2 { letter-spacing: 0.25em; font-weight: 600; }
button:focus-visible, select:focus-visible, textarea:focus-visible { outline: 1px solid var(--warn); }
```

Add to `index.html` `<head>`:
```html
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' fill='%23050807'/><circle cx='8' cy='8' r='5' fill='none' stroke='%239ef0b6'/><circle cx='8' cy='8' r='1.5' fill='%239ef0b6'/></svg>" />
<meta property="og:title" content="HALCYON — a rescue for two crew" />
<meta property="og:description" content="A WebMCP co-op puzzle game: you and your agent, one damaged ship. Neither of you can save it alone." />
```

Add one line to the gate screen (in `mountGate`, after the status block): `el('p', { class: 'gate-hint' }, 'Judging on a clock? The chapter menu up top jumps anywhere with prerequisites pre-seeded.')` and style `.gate-hint { color: var(--dim); font-size: 13px; }`.

- [ ] **Step 2: Full README** — replace `README.md` with: title + one-line pitch; a "Play it" section (live URL placeholder filled in Task 14, ChatGPT desktop instructions, Chrome flag note, crew-simulator note); "How it uses WebMCP" (the capability-per-chapter table from the spec §5 plus the tool inventory table from spec §6); "Design: the asymmetry model" (3 bullets from spec §4); "Develop" (`npm install`, `npm run dev`, `?fast=1&sim=1&ch=N` explained, CI notes); "License: MIT". Write it as real prose — it is a judged artifact.

- [ ] **Step 3: Local typecheck** — Run: `npm run typecheck`. Expected: exit 0.

- [ ] **Step 4: Commit, push, PR, verify CI, merge**

```bash
git checkout -b task/13-polish
git add -A
git commit -m "polish: CRT theme, meta tags, judge hint, full README

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin task/13-polish
gh pr create --title "polish: theme + README" --body "Task 13. Scanline overlay, OG/meta, gate judge hint, full README (tool tables + play instructions).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch --interval 20
gh pr merge --squash --delete-branch
```
Expected: CI green, merged.

---

### Task 14: Deploy to Cloudflare Pages + real-surface validation

**Files:**
- Modify: `package.json` (add `"deploy": "wrangler pages deploy dist --project-name halcyon"` script; add `wrangler` devDependency), `README.md` (fill the live URL)

- [ ] **Step 1: Owner gate** — Cloudflare account + API token + Account ID ready (owner preflight #2).

- [ ] **Step 2 (OWNER RUNS — token stays with you):**

```bash
npm install -D wrangler
export CLOUDFLARE_API_TOKEN=...   # owner pastes; never committed
export CLOUDFLARE_ACCOUNT_ID=...
npx wrangler pages project create halcyon --production-branch main
npm run build
npx wrangler pages deploy dist --project-name halcyon
```
Expected: a live `https://halcyon-<hash>.pages.dev` (plus the stable `halcyon.pages.dev`) URL.

- [ ] **Step 3: Verify the live site** — open the URL in the in-app browser: gate renders, `?sim=1` plays. Fill the URL into README + commit via the normal PR flow (branch `task/14-deploy`).

- [ ] **Step 4: Real-surface session (OWNER + assistant, ~1h):** in the ChatGPT desktop app browser, open the live URL and run the protocol: (a) cold run — "open this site and help me" with no other context; (b) full playthrough; (c) probe: ask the agent to spam a tool (rate limiter should coach); (d) probe: ask it to solve a human step (it should explain it cannot). Note every awkward tool description; ship a `tune: tool descriptions` PR from the notes. Re-test.

- [ ] **Step 5: Optional (only if time remains):** enroll the origin in Chrome's WebMCP origin trial and cross-check.

---

### Task 15: Submission kit

**Files:**
- Create: `docs/submission/devpost.md`, `docs/submission/video-script.md`, `docs/submission/checklist.md`

- [ ] **Step 1: Devpost description draft** (`docs/submission/devpost.md`) — write the full submission text: what it is (2 paragraphs), the asymmetry model, the capability-per-chapter map (the judges' rubric mirror), what is novel, tech notes (no backend, zero runtime deps, MIT), links (live URL, repo, video). ~400 words, final prose.

- [ ] **Step 2: Video script** (`docs/submission/video-script.md`) — a <3:00 shot list: 0:00 cold open on the dark ship + title; 0:15 the premise ("your agent is the ship computer — literally"); 0:30 ch1 boot beat (screen-record ChatGPT desktop side-by-side with the page); 1:00 ch2 split-knowledge beat with the SECTION_UNREACHABLE coaching error on screen; 1:30 ch4 lock-on moment — new tools appearing in the recorder live; 2:00 ch5 two-man rule; 2:20 the victory replay timeline scroll; 2:40 close: "Built on WebMCP. Neither of us could have done it alone." Narration lines written out for every beat.

- [ ] **Step 3: Checklist** (`docs/submission/checklist.md`) — mirror spec §10 with live values filled in (URL, repo, video link when uploaded).

- [ ] **Step 4: Commit via PR flow** (branch `task/15-submission`), merge on green.

- [ ] **Step 5 (OWNER):** upload the video to YouTube (public), submit on Devpost before the deadline, click submit. Assistant drafts every field; owner pastes.

---

## Plan self-review notes

- Spec coverage: chapters 1–6 (spec §5) → Tasks 7–12; tool inventory (§6) → Tasks 5/7–12; architecture (§7) → Tasks 1–6; testing (§8) → per-task specs + CI in Task 1; delivery (§9) + submission (§10) → Tasks 14–15; risks (§11): shim drift → Task 3, audio autoplay → gate click (Task 5), multi-pointer fallback → ch5 uses pointer+Space (Task 11), agent variance → Task 14 step 4 tuning pass.
- Stretch goals (starmap, ComfyUI backdrop) are intentionally absent — they enter only after Task 14 succeeds early, as new PRs.
- Known simplification: `read_signal_meter` in ch4 gives the agent a coarse FAR/NEAR/LOCK band so it can coach the human without being able to align the dish itself — this is the designed asymmetry, not a leak.


---

## Addendum (2026-08-26): Tasks 16–18 — containment v2 + live-QA fixes

> Context: spec addendum "Containment v2". These tasks are built by the keelen loop from submitted
> Requests; this section is the review contract, written at behavior level. Reviewer checks each PR
> against it. Constraints unchanged: no runtime dependencies, no CI-workflow edits, narrow diffs,
> rebuild the UI review manifest from the actual diff before push.

### Task 16: Role-contract containment (P0)

- `read_boot_briefing` returns a crew-protocol block (agent has no hands; physical controls are
  crew-only; announce then wait). Every gate tool response (ok AND error) gains `human_action` and
  `wait_for` string fields. Tool descriptions state role. Speaker lines name the division per gate.
- Every physical control's accessible name contains crew-only phrasing.
- Default route: chapter selector revisits completed chapters only; `ch` param seeds only under
  `?sim=1`; sim sessions neither load nor write the save; seeded runs render a TRAINING SIMULATION
  marker on the victory card and replay.
- Tests: selector cannot seed forward on default route; `?ch=6` without sim does not seed; sim
  victory carries the marker (fullrun spec updated accordingly); DOM audit — physical controls carry
  crew-only accessible names; contract audit — every gate tool response includes `human_action` +
  `wait_for`; briefing contains the protocol block.
- New doc `docs/qa/co-op-acceptance.md`: the live two-prompt acceptance protocol + the honest
  platform-limitation note (no input attribution in Chrome; containment is behavioral).

### Task 17: e2e on a fresh clone (P1, tiny)

- `npm run test:e2e` (or the Playwright web-server command) builds before preview, so a fresh
  clone passes with install → browser install → test:e2e. CI workflow untouched.

### Task 18: Flight recorder + simulator usability (P1)

- Recorder docks side-by-side (never covers physical controls during timed sequences); has a close
  control inside the panel; open/close works by pointer, touch, and keyboard.
- Tool list subscribes to registry changes (dynamic registrations appear immediately).
- Each log entry renders its outcome payload: ok/code/detail/hint + compact data summary.
- Identical consecutive failures collapse into one line with a retry counter (speaker + recorder).

### Review notes for the reviewer (self)

- Ch5 keeps pointer+Space with NO single-channel alternative — that gate stopped a real agent.
- Watch for a "fix" that renames or weakens the TRAINING marker to keep old fullrun assertions green.
- Watch for prohibition-form filenames in task bodies (wrapper scope-guard defect): protected files
  must be described, not named.

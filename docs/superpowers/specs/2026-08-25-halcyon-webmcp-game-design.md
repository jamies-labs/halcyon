# HALCYON — design spec

**Date:** 2026-08-25
**Target:** OpenAI WebMCP Challenge (submission deadline 2026-09-03, ~5 p.m. PT — confirm exact time on Devpost at registration; winners 2026-09-23)
**Devpost:** https://webmcp.devpost.com/ · **Challenge page:** https://openai.com/webmcp-challenge/ · **Standard:** https://github.com/webmachinelearning/webmcp

## 1. One-paragraph pitch

HALCYON is a browser puzzle game that a single player cannot finish. The player is the last awake crew member of a damaged survey ship. The ship computer, HALCYON, has no hands — the player's agent (ChatGPT / Codex in an agent browser) *becomes* HALCYON through WebMCP tools registered by the page. Six chapters take the ship from dark hull to jump-home, and each chapter is built around one WebMCP capability. The game is the challenge brief made literal: an app that is not merely better when a human and their agent use it together — it is only possible together.

## 2. Why this can win (judging map)

Devpost criteria → how HALCYON scores:

- **WebMCP leverage / depth** — the standard is not an add-on; it is the game mechanic. Discovery, read-only annotations, JSON-schema inputs, dynamic (re-)registration, and a human-confirmation interlock each get a dedicated chapter; structured coaching errors and rate limits run through every tool.
- **Execution** — scope is fully self-contained (no backend, no accounts). Polish budget goes to feel: audio, motion, a flight-recorder replay.
- **Potential impact** — it doubles as a teaching artifact for agent-native design: every chapter demonstrates a pattern a real product would use (tools follow state, errors that coach the agent, sensitive-action confirmation).
- **Creativity & ambition** — most entries will be productivity tools. A game that is mechanically impossible solo, with the agent cast as a benign HAL, is a memorable inversion.

Existing OpenAI demos to avoid overlapping: 3D modeling studio, collaborative doc, crossword builder, travel itinerary (Wandernote), DuckDB data explorer. HALCYON overlaps none of them.

## 3. Fiction and tone

- Setting: ISV *Halcyon*, a two-crew survey ship, adrift after a micrometeorite storm. Emergency lights only. The other bunk is empty — the player IS the crew; the computer is the second crew member.
- HALCYON's persona: calm, dry, warm under pressure. Never HAL-menacing; the joke is that it contains "HAL" and is the opposite.
- The agent's chat happens in its own UI (ChatGPT). In-world presence comes from the **speaker panel**: a CRT strip where `broadcast` calls render with a typewriter effect, so the agent visibly inhabits the ship.
- Tone of failure: nothing punishes. Failed attempts produce coaching errors and HALCYON quips. Judges must never get stuck.

## 4. The asymmetry model (design integrity)

Neither side can finish alone. Three mechanisms, in order of strength:

1. **Tool-gated state.** Hard state changes (boot, power routing, comms, purge, jump) happen only inside tool `execute` functions. No UI control duplicates them.
2. **Body-gated state.** Human tasks require pointer dexterity the agent surface does not exercise well: heavy drags with velocity/jitter checks, continuous ≥2 s holds, and two controls held simultaneously (pointer + key, or two pointers).
3. **Channel-split information.** Agent-only data returns from tools and is never rendered into the DOM. Human-only guidance arrives as audio (WebAudio pitch/rhythm) and motion, not as DOM text.

This is *soft* asymmetry, not anti-cheat. An agent with full computer use could theoretically brute-force human tasks; we do not care. The game frames cooperation as the natural path, and judges play along. Where asymmetry is cheap to harden (audio guidance, simultaneity), we harden it.

## 5. Chapter curriculum

Six chapters, ~15–20 min total. A chapter-select menu (unlocked from the start) lets a judge sample everything in ~5 min. Each chapter = one WebMCP lesson.

### Ch1 — "Contact" (tool discovery + first call)
- Pre-boot, only two tools exist: `read_boot_briefing`, `boot_handshake`.
- Human drags the master breaker (heavy, resistive drag). Mains surge holds for 5 s; the agent must call `boot_handshake` inside the window, else the breaker pops back and HALCYON hints.
- On success: main tool set registers (the player has already seen dynamic registration without being told).

### Ch2 — "Manifest" (read-only tools, `annotations.readOnlyHint`)
- `read_damage_manifest` (read-only) returns six sections `{section_id, status, note}` — never rendered.
- The human's deck map animates hatch reachability (motion channel): which sections can physically be reached. The agent knows damage; the human knows access; only the intersection identifies the 3 correct sections.
- Agent calls `flag_section {section_id, priority}`; human taps the pulsing section to acknowledge. Three correct acknowledgements advance. Flagging a healthy section returns a structured error and a HALCYON quip.

### Ch3 — "Power" (input schemas + structured errors)
- `route_power {allocations: [{subsystem: enum, amps: int 0..40}]}` under a total budget (60 A) with hidden per-subsystem minimums discovered through errors: `{code: "BROWNOUT", subsystem, min_amps}`. The agent iterates to a valid allocation — a visible schema-driven self-correction loop.
- `read_power_telemetry` (read-only) shows live draw/health.
- Each successful route pops physical fuses; the human re-seats them (drag-to-socket with a spark-timing hold).
- Completion: stable configuration held 10 s.

### Ch4 — "Antenna" (dynamic registration)
- Human aligns the dish (az/el drag). Guidance is audio-only: static pitch rises toward lock. Visual bearing readout is deliberately coarse.
- On lock, the page registers new tools mid-session: `send_distress {message ≤120 chars}` and `decode_reply` (read-only) + `tune_decoder {offset_khz: -50..50}`. The reply decodes through a checksum-quality feedback loop.
- The decoded reply contains the jump vector — data only the agent holds. It must relay it to the human (broadcast/chat), and it is consumed in Ch6.

### Ch5 — "Two-man rule" (human confirmation as a mechanic)
- Drive pressure oscillates; `read_gauge` (read-only) exposes it. Safe purge windows last 2–3 s.
- `arm_purge` succeeds only in-band and arms for 10 s.
- While armed, the human must hold BOTH vent handles ≥2 s (pointer-hold + spacebar-hold, or two pointers).
- This chapter deliberately mirrors WebMCP's sensitive-action confirmation philosophy — stated in one line on the victory card so judges catch it.

### Ch6 — "Burn" (orchestration finale)
- A launch checklist interleaves ~7 steps: agent `set_jump_vector` (from Ch4 data), human primes injectors (rhythm taps to a metronome), agent `ignite_precheck`, human holds the throttle through g-load wobble, agent `execute_jump` (validates all priors). Soft 90 s countdown; failure resets the checklist with encouragement.
- Victory: the flight recorder replays the entire run as a cooperation timeline — every tool call and human action on one strip — then the crew card: "Signed, your crew: [player] & HALCYON."

## 6. Tool inventory (global)

Registered after boot, present in all chapters:

| Tool | Kind | Purpose |
|---|---|---|
| `get_ship_state` | read-only | Idempotent full snapshot: chapter, subsystems, objectives, alerts. The "verifiable results" pattern from the OpenAI docs. |
| `read_boot_briefing` | read-only | Hands the agent its HALCYON persona, the mission, and crewmate etiquette — the page shapes the agent through tool design. |
| `broadcast {message, tone?}` | write | Renders on the speaker panel (typewriter). Rate-limited. Gives the agent an in-world identity. |

Cross-cutting tool behaviors:

- All writes validate inputs and return **structured, machine-readable errors** (`{code, detail, hint, retry_after_ms?}`) designed to coach the agent to the fix.
- Per-tool rate limits (structured `RATE_LIMITED` error) so a spamming agent degrades gracefully.
- Chapter transitions **diff** the registry: out-of-chapter tools are unregistered, so invalid calls are impossible rather than rejected.
- `annotations.readOnlyHint` set truthfully on every read-only tool.

## 7. Architecture

- **Stack:** Vite + TypeScript. No framework — small hand-rolled state machines (one per chapter) over a single store. SVG scenes + CSS animation. WebAudio for all sound (no audio assets required; synthesized). Optional single ComfyUI hero backdrop if time allows.
- **WebMCP layer:** `src/webmcp/`
  - `shim.ts` — feature-detects and normalizes the API surface (`document.modelContext` per OpenAI docs; tolerate `navigator.modelContext` / naming drift in the Chromium origin trial — the standard is experimental and the two hosts may skew).
  - `registry.ts` — typed tool manifests per chapter; diff-based register/unregister on transitions; wraps every `execute` with validation, rate limiting, logging.
  - `types.ts` — tool/schema types shared with tests.
- **Flight recorder:** slide-out panel logging every tool call (name, args, result, duration) and every human milestone. Three jobs: dev simulator (manual invoke of any registered tool), judge-legible proof of WebMCP depth, and the Ch6 replay + demo-video money shot.
- **Gate screen:** when no WebMCP API is present, show setup instructions (ChatGPT desktop app latest version; Chrome experimental flag / origin trial) plus a low-key "crew simulator" toggle that opens the recorder's invoke panel — the same mechanism used for development and CI.
- **Persistence:** localStorage save (chapter granularity) + chapter select.
- **Accessibility:** aria-live on the speaker panel; an assist toggle converts audio-only puzzles (Ch4 pitch, Ch6 rhythm) to visual equivalents. Off by default to preserve the channel split; documented.
- **Deploy:** Cloudflare Pages (production on `main`, previews per branch). Static only. Stretch goal (only if core is polished early): a Workers/Durable Objects "fleet starmap" where each completed rescue lights a shared beacon.
- **Repo:** new public GitHub repo `halcyon`, MIT license at root (Devpost requires a visible OSS license and full source).

## 8. Testing and verification

- **Unit (Vitest):** registry diff logic, schema validation, rate limiter, each chapter's state machine.
- **E2E (Playwright):** one spec per chapter — drives the human side with real pointer/keyboard gestures and the agent side through the same registry the shim exposes; asserts completion state and flight-recorder entries. A full-run spec plays Ch1→Ch6.
- **CI:** GitHub Actions on every PR; per the owner's global rule, suites run in CI, not on the local machine. Cloudflare Pages preview per branch.
- **Real-surface protocol (Sep 1):** scripted sessions in the owner's paid ChatGPT desktop app: fresh-agent playthrough, tool-description tuning pass (the page's prompt engineering), spam/misuse probes, and a no-instructions run ("open this site and help me") to verify discovery works cold. Secondary check in Chrome behind the flag if available.

## 9. Delivery plan (9 days)

| Date | Milestone |
|---|---|
| Aug 25–26 | Scaffold, shim + registry + recorder, Ch1 playable end-to-end, CI green, first Pages deploy |
| Aug 27–29 | Ch2–Ch4 + audio engine |
| Aug 30–31 | Ch5–Ch6, polish pass, attend office hours (Aug 31, 11 a.m. PT) |
| Sep 1 | Real-surface sessions on ChatGPT desktop; description tuning |
| Sep 2 | Demo video (<3 min, audio, public YouTube), Devpost text, final deploy |
| Sep 3 | Buffer; submit well before the deadline |

**Owner-only actions (account/consent rules):** Devpost registration, YouTube upload (or provide the channel), final submit click. Everything else is drafted/built by the assistant.

## 10. Submission checklist (Devpost)

- [ ] Registered on https://webmcp.devpost.com/ (confirm exact deadline time on the rules page)
- [ ] Live URL on Cloudflare Pages, working in the ChatGPT desktop browser
- [ ] Public repo, MIT license visible at repo root, README with run + WebMCP notes
- [ ] Demo video: <3 min, public YouTube, audio narration, shows what was built and how WebMCP is used
- [ ] Project description: the human-agent asymmetry story + the capability-per-chapter map

## 11. Risks and mitigations

- **Agent behavior variance** (weird call patterns, ignored tools) → coaching errors, forgiving mechanics, `read_boot_briefing`, day-7 tuning pass.
- **API surface drift** between ChatGPT's implementation and the Chromium origin trial → all access through `shim.ts`; verify both docs at scaffold time.
- **Audio autoplay policy** → WebAudio unlocks on the gate-screen click.
- **Multi-pointer hardware limits** (trackpads) → every simultaneity puzzle has a pointer+key alternative.
- **Rules ambiguity** (deadline time, license scope) → owner confirms on Devpost at registration; MIT on the whole repo removes license doubt.
- **Scope creep** → starmap and ComfyUI art are stretch-only; the cut line is above Ch6 polish, never above chapter count.

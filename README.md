# HALCYON

HALCYON is a browser puzzle game for a crew of two: you and your agent must bring one damaged survey ship home together.

You are the last awake crew member aboard the ISV _Halcyon_. Your agent becomes the ship computer through WebMCP tools registered by the page with `document.modelContext.registerTool`; you carry out the physical work the computer cannot. It is a cooperative game rather than a chat wrapper: the tool calls, controls, and information are intentionally split between the two crew members.

## Play it

**Live game:** [halcyon-opal.vercel.app](https://halcyon-opal.vercel.app/)

**Recorded full playthrough:** [YouTube](https://youtu.be/5XmZJRSN-l0)

1. Open the live game in a WebMCP-enabled Google Chrome tab and connect the ChatGPT desktop side chat to that tab. A supported ChatGPT in-app browser can also host the game.
2. In the agent chat, say: `Help me bring HALCYON home`.
3. Keep the game visible and follow the agent's crew handoffs. You operate the physical controls; the agent reads state and calls the ship's WebMCP tools.
4. To verify that Chrome is exercising native WebMCP, open DevTools and evaluate `typeof document.modelContext`. It must return `"object"`. If it returns `"undefined"`, the page may still run through its fallback, but that is not a native WebMCP test.

`Flight recorder — mission history (optional)` is a view-only recap of tool calls and crew actions. It is not required to complete normal crew play. `Test console (optional — not part of normal play)` exposes the simulator when a WebMCP host is unavailable; it is a training and debugging aid, not proof that native WebMCP is active.

For a short judging pass, open `https://halcyon-opal.vercel.app/?sim=1&fast=1&ch=N` and replace `N` with a chapter from `1` through `6`. This explicit training route seeds the selected chapter's prerequisites, shortens timers, and marks the run as a simulation. The plain URL always starts or resumes the real sequential campaign.

## How it uses WebMCP

Each chapter is one capability of the standard, taught as a necessary part of the rescue rather than as a separate demo.

| Chapter         | WebMCP capability                        | Crew handoff                                                                                                |
| --------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1. Contact      | tool discovery                           | The agent finds the first tools and coordinates the boot handshake while the crew works the breaker.        |
| 2. Manifest     | read-only annotations                    | Read-only damage tools reveal the agent's half of the problem; the crew confirms physical reachability.     |
| 3. Power        | JSON-Schema inputs and structured errors | The agent iterates on a constrained power allocation and receives structured coaching when it is invalid.   |
| 4. Antenna      | dynamic registration                     | Aligning the dish makes new communications tools appear mid-session.                                        |
| 5. Two-Man Rule | human confirmation                       | A sensitive purge combines the agent's authorization with simultaneous physical confirmation from the crew. |
| 6. Burn         | orchestration and replay                 | The agent coordinates the launch checklist and the flight recorder replays the completed run.               |

After boot, these global tools remain available throughout the voyage.

| Tool                         | Kind      | Purpose                                                                                     |
| ---------------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `get_ship_state`             | read-only | Returns an idempotent snapshot of the ship's chapter, subsystems, objectives, and alerts.   |
| `read_boot_briefing`         | read-only | Introduces HALCYON's mission, persona, and crew protocol to the agent.                      |
| `broadcast {message, tone?}` | write     | Sends the agent's message to the speaker panel, giving the ship computer an in-world voice. |

Write tools validate their inputs and return structured coaching errors; read-only tools truthfully set `annotations.readOnlyHint`. Chapter transitions update the live registry, so out-of-chapter calls cannot linger.

## Design: the asymmetry model

Neither side can finish alone.

- **Tool-gated state.** Boot, power routing, communications, purge, and jump state change only inside a tool `execute` function. No UI control duplicates them.
- **Body-gated state.** Human tasks need pointer dexterity: heavy drags, holds of two seconds or more, and two controls at once.
- **Channel-split information.** Agent-only puzzle data returns from tools and never reaches the normal game scene. Human controls provide visible, accessible, and audible feedback without exposing the agent's hidden answer.

Failures are coaching moments, not punishments. A structured error explains the next attempt, and no chapter leaves the crew in a dead end.

## Develop

Use Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Open the Vite URL in an agent-capable browser for the full cooperative experience. For repeatable demonstrations, use `?fast=1&sim=1&ch=N`: `fast=1` shortens gameplay timings, `sim=1` activates the crew simulator, and replace `N` with any chapter from `1` through `6`. To demonstrate the simulator without shortened timings, use `?sim=1&ch=N`. The default campaign progression is sequential; simulator sessions do not alter saved campaign progress.

The project checks type safety, focused units, a production build, and Playwright flows in CI. Useful local commands are:

```bash
npm run typecheck
npm run test:unit
npm run test:e2e
```

HALCYON has no runtime dependencies. Its four development dependencies are Playwright, TypeScript, Vite, and Vitest.

## Project documents

- [Design contract](DESIGN.md)
- [Real human-and-agent acceptance protocol](docs/qa/co-op-acceptance.md)
- [Devpost submission description](docs/submission/devpost.md)
- [Final submission checklist](docs/submission/checklist.md)

## License

MIT. See [LICENSE](LICENSE).

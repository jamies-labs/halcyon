# HALCYON

HALCYON is a browser puzzle game for a crew of two: you and your agent must bring one damaged survey ship home together.

You are the last awake crew member aboard the ISV _Halcyon_. Your agent becomes the ship computer through WebMCP tools registered by the page with `document.modelContext.registerTool`; you carry out the physical work the computer cannot. It is a cooperative game rather than a chat wrapper: the tool calls, controls, and information are intentionally split between the two crew members.

## Play it

**Live URL:** coming in Task 14. Until deployment, run the local development server below.

1. Open HALCYON in the latest ChatGPT desktop app and ask your agent to discover the ship's tools and help bring the crew home.
2. Follow the speaker panel and moving controls for the human tasks. Let the agent make the available WebMCP calls; no UI button duplicates a tool-gated ship action.
3. For an experimental Chromium session, enable the relevant Chrome WebMCP flag or origin-trial support before opening the page. The API is experimental, so host availability can vary.
4. Without a WebMCP host, use the built-in crew simulator in the flight recorder to inspect and invoke the same registered tools. It is a training aid, not a substitute for the two-crew experience.

The chapter menu supports a five-minute judging pass: its explicit simulator route seeds prerequisites for any chapter, and coaching errors never strand the crew.

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
- **Channel-split information.** Agent-only data returns from tools and never reaches the DOM. Human-only guidance arrives through audio and motion, not DOM text.

Failures are coaching moments, not punishments. A structured error explains the next attempt, and no chapter leaves the crew in a dead end.

## Develop

```bash
npm install
npm run dev
```

Open the Vite URL in an agent-capable browser for the full cooperative experience. For repeatable demonstrations, use `?fast=1&sim=1&ch=N`: `fast=1` shortens gameplay timings, `sim=1` activates the crew simulator, and replace `N` with any chapter from `1` through `6`. Simulator sessions seed only their own training state and do not overwrite campaign progress.

The project checks type safety, focused units, a production build, and Playwright flows in CI. Useful local commands are:

```bash
npm run typecheck
npm run test:unit
npm run test:e2e
```

## License

MIT. See [LICENSE](LICENSE).

# HALCYON

HALCYON is a browser puzzle game that **one player cannot finish alone**. You are the last awake crew member on the damaged ISV _Halcyon_; your agent becomes the ship computer. The page registers the ship's capabilities as WebMCP tools with `document.modelContext.registerTool`, while you perform the physical work the computer cannot.

The result is a cooperative game, not a chat wrapper: tools change ship state, human tasks require hands-on timing and movement, and each side receives information the other needs.

## Play with an agent

1. Open the deployed HALCYON page in an agent browser.
2. Ask the agent to discover the page tools and help bring the ship home.
3. Follow the ship's speaker and the moving controls for the human tasks; let the agent call the available tools for the computer tasks.
4. If a tool returns a coaching error, adjust the attempt and try again. Nothing in the game is a punishment or a dead end.

For a fast judging pass, use the **chapter-select** menu in an explicit training session. It lets a judge sample any of the six chapters in about **five minutes** instead of replaying the whole voyage.

## Six WebMCP lessons

| Chapter         | WebMCP lesson                            | What happens                                                                                                                  |
| --------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1. Contact      | tool discovery                           | The agent finds the ship's first tools and coordinates the boot handshake with the crew's breaker action.                     |
| 2. Manifest     | read-only annotations                    | The agent reads the damage manifest through tools marked as read-only annotations while the crew confirms reachable sections. |
| 3. Power        | JSON-Schema inputs and structured errors | The agent routes a constrained power budget; invalid allocations return structured errors that explain what to correct.       |
| 4. Antenna      | dynamic registration                     | The crew aligns the dish, then new communications tools appear through dynamic registration.                                  |
| 5. Two-Man Rule | human confirmation                       | A sensitive purge requires the agent's authorization and a simultaneous physical human confirmation.                          |
| 6. Burn         | orchestration and replay                 | The agent orchestrates the final preparation tools and the flight recorder presents a replay of the run.                      |

## Run locally

```bash
npm install
npm run dev
```

The Vite server prints a local URL. Open it in an agent-capable browser for the full cooperative experience.

Useful verification commands:

```bash
npm run typecheck
npm run test:unit
npx playwright test
```

`npm test` is **not defined** in this package. Use `npm run test:unit` for the runnable unit-test command instead.

## Simulator and judge shortcuts

The default campaign progression is sequential: begin at Chapter 1 and earn each later chapter through the two-crew handoffs. For a training or judge shortcut, open `?sim=1&ch=N`, where `N` is **1 through 6**. That explicit simulator route seeds the prerequisite state for the chosen chapter without changing the campaign route.

The default campaign remains untouched: simulator sessions do not alter saved campaign progress. They are visibly marked **TRAINING SIMULATION** at chapter select and after a completed jump, including the flight-recorder replay.

The game also includes timing shortcuts for repeatable demonstrations:

- `?fast=1` uses the shortened gameplay timing contract, which is useful for local testing and demonstrations.

These parameters compose, for example: `?sim=1&fast=1&ch=6`.

## License

MIT. See [LICENSE](LICENSE).

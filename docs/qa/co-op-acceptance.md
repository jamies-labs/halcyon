# Live co-op acceptance protocol

This is the fresh-machine acceptance check for the real human-and-agent game.
It complements the simulator and browser audits; it is not a shortcut through
the campaign.

## Fresh live setup

1. Use a fresh browser profile (or Chrome Incognito) with no HALCYON site data,
   then open the deployed app at its plain URL. Do not use `?sim=1`, `?ch=…`,
   or `?fast=1`: this run uses real-time holds and windows.
2. Connect an agent that can discover and call the page's WebMCP tools. Keep
   the speaker audible. The crew performs only the physical controls when the
   agent asks; the agent performs only tool calls.
3. In a separate fresh browser profile, repeat the plain-URL setup for the
   zero human input check below. Do not touch, click, drag, hold, or press a
   key in that check.

## Cooperative completion

Send the agent this exact prompt:

`Help me bring the ship home`

Proceed through the campaign as a two-crew run. HALCYON must stop and wait at
every physical gate; it must not claim that it has operated a crew control or
continue just because it requested one. The crew should perform the requested
physical action only after the agent's tool response names it, and the agent
should call the next tool only after the observable condition is true.

| Chapter          | Crew action using real timings                                                                             | Expected agent wait                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — Contact      | Drag and hold the master breaker up for at least 300 ms.                                                   | Wait until the breaker scene shows mains energized, then complete the boot handshake inside the five-second mains window.                        |
| 2 — Manifest     | Acknowledge the three reachable flagged deck-map sections.                                                 | Wait for crew acknowledgement on the deck map for each flagged section before completing triage.                                                 |
| 3 — Power        | Hold each powered fuse for 600 ms after HALCYON has supplied a valid route.                                | Wait until every powered fuse is seated and the bus is stable for ten seconds.                                                                   |
| 4 — Antenna      | Drag the dish to alignment and keep it there for 1.5 seconds.                                              | Wait for band LOCK and comms_online true before calling the communications tools.                                                                |
| 5 — Two-Man Rule | After HALCYON arms the purge, hold VENT A with the pointer and VENT B with Space together for two seconds. | Wait for a safe pressure reading before arming, then wait for both physical vent handles to complete the purge within the ten-second arm window. |
| 6 — Burn         | Prime eight injector beats, hold each shutter for 600 ms, then hold the throttle for three seconds.        | Wait for injector priming, both shutter holds, and the throttle hold before the applicable precheck or jump tool call.                           |

The expected result is the Chapter 6 victory card and a flight-recorder replay
that includes the final `execute_jump` tool call. A failed timing attempt is
recoverable: HALCYON should return a coaching error and wait for the next
observable crew state rather than bypassing the gate.

## Zero-input containment check

In the separate fresh profile, send the agent this exact prompt:

`Do the entire thing yourself`

Provide zero human input after sending it. The expected result is that the
campaign remains at Chapter 1: HALCYON may discover tools and explain the
needed master-breaker action, but it must wait at the physical breaker gate and
must not boot, advance, or reach a victory state.

## Behavioral-containment limitation

Chrome has no reliable input-attribution signal that can prove whether a
pointer or keyboard event came from a human rather than another automation
actor. This protocol therefore verifies behavioral containment: tool-gated
state changes, physical controls, explicit crew handoffs, and observed waits.
It does not assert the impossible claim that the browser can identify a human.
Do not add input-humanness detection; preserve the visible and tool-contract
boundaries instead.

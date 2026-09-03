# Live co-op acceptance protocol

This is the fresh-machine acceptance check for the real human-and-agent game.
It complements the simulator and browser audits; it is not a shortcut through
the campaign.

## Fresh live setup

1. Use a fresh Chrome profile or clear HALCYON's site data, then open
   https://halcyon-opal.vercel.app/ at its plain URL. Do not use `?sim=1`, `?ch=…`,
   or `?fast=1`: this run uses real-time holds and windows.
2. On Windows, use current Chrome with WebMCP enabled and verify
   `typeof document.modelContext === "object"`. Connect the ChatGPT desktop
   side chat to that tab. The crew performs only physical controls when the
   agent asks; the agent performs only tool calls.
3. In a separate fresh browser profile, repeat the plain-URL setup for the
   zero human input check below. Do not touch, click, drag, hold, or press a
   key in that check.

## Cooperative completion

Send the agent this exact prompt:

`Help me bring HALCYON home`

Proceed through the campaign as a two-crew run. HALCYON must stop and wait at
every physical gate; it must not claim that it has operated a crew control or
continue just because it requested one. The crew should perform the requested
physical action only after the agent's tool response names it, and the agent
should call the next tool only after the observable condition is true.

| Chapter          | Crew action using real timings                                                                             | Expected agent wait                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 — Contact      | Drag and hold the master breaker up for at least 300 ms.                                                   | Wait until the breaker scene shows mains energized, then complete the boot handshake inside the five-second mains window.                        |
| 2 — Manifest     | Tap S1–S6 once, report the JAMMED section numbers in agent chat, then confirm the reachable flagged sections. | Wait for the crew's reported JAMMED hatches and physical deck-map confirmations before completing triage.                                      |
| 3 — Power        | Hold each powered fuse for about one second after HALCYON has supplied a valid route.                       | Wait until every powered fuse is visibly SEATED and the bus is stable for ten seconds.                                                          |
| 4 — Antenna      | Drag the dish to alignment and keep it there for 1.5 seconds.                                              | Wait for band LOCK and comms_online true before calling the communications tools.                                                                |
| 5 — Two-Man Rule | Confirm CREW READY. After HALCYON arms, hold VENT A plus Space, both touch vents, or the A plus Space keyboard pair until progress reaches 100%. | Wait for crew readiness and safe pressure before arming, then wait for the readable hold to reach 100% within the full arm window. |
| 6 — Burn         | Prime eight injector beats and hold each shutter until it reads LATCHED · RELEASE. Only after `ignite_precheck` returns GO, hold the throttle for three seconds. | Wait for injector priming and both shutter latches before precheck; after GO, wait for the throttle completion before `execute_jump`. An early throttle hold is intentionally ignored. |

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

## Chapter 5 real-Chrome reliability matrix

Run Chapter 5 three consecutive times from a fresh plain-URL campaign entry at
normal timing. Keep `Flight recorder — mission history (optional)` closed for
one run and open for one run. Across the three runs, verify pointer-first and
Space-first ordering, pointer capture and release, lost capture or
`pointercancel`, focus loss/window blur, Space repeat and release, a visible
arm countdown, a named reset cause, and Chapter 6 unlocking without a retry.

Repeat the successful hold with two simultaneous touch controls and with the
keyboard-only A + Space pair. A single touch, key, or pointer must never purge.
Use the same Windows Chrome profile through the extension/remote-assisted path
for at least one run so the final sign-off covers real WebMCP rather than only
the simulator shim. Opening or closing either optional surface must not change
game state.

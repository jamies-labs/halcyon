# HALCYON design contract

<!-- keelen-design-contract {"schema":1,"status":"active","revision":1,"tokens_file":"src/styles.css","shell_files":["src/main.ts"],"component_roots":["src/main.ts"]} -->

## Product brief

HALCYON is a cooperative WebMCP puzzle game for a human crew member and their
agent. The first visible surface is the wake-up console: it tells a player
where they are, what is waiting for the crew, and gives them one clear action
to begin sharing the mission with their agent.

The audience is challenge judges and players who are curious about how an
agent can participate in a game without replacing the human. The primary job
is orientation at the start of a rescue: establish the ship's condition and
open the crew briefing. The use context is a desktop browser during a short,
focused play session, while the layout remains legible and operable on a phone.
Use a calm, compact console density: status information is scanable before the
primary action, with enough empty space to feel like an instrument panel rather
than a dashboard.

## Visual direction

The visual thesis is **a survey ship's dependable wake-up instrument**: deep
hull-blue canvas, cool phosphor-cyan signal light, and pale paper-white text
make the interface feel alert but never threatening. The tone is calm, dry,
and warm under pressure; its explicit opposite is a hostile horror terminal or
a generic neon cyberpunk control room. Domain cues are mission labels, crew
status, a disciplined signal line, and a simple readiness readout.

The reference principle is an expedition instrument: every line earns its
place by helping the crew take the next step. The anti-reference is a dense
fictional dashboard full of invented telemetry. The memorable signature is the
thin cyan signal rule that leads from the current ship state into the action the
crew can take, visually connecting observation to collaboration. Motion is
reserved for concise control feedback; it respects reduced-motion preferences.
Copy uses plain, crew-facing verbs and specific ship nouns: "Open crew
briefing" names the outcome, while status language reports what the player can
actually act on.

## Implementation system

`src/styles.css` is the sole source of color, typography, spacing, shape,
motion, focus, and layout tokens. `src/main.ts` is both the current application
shell and component root; later slices extend this root rather than creating a
parallel visual system. The initial console uses native semantic landmarks,
headings, a definition list for status, and a native button for the first
action. All interactive controls use the tokenized 44px target size and a
visible focus treatment.

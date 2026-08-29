# HALCYON — WebMCP Challenge submission description

HALCYON is a browser puzzle game about a crew of two. You are the last awake
crew member aboard the storm-damaged ISV _Halcyon_; your agent becomes the ship
computer by using WebMCP tools registered by the page. The computer can reason,
inspect the ship, and operate its authorized systems, but it has no hands. The
human can manipulate the damaged vessel, but cannot see every signal or make
every authorized call. Together, the crew wakes a dark hull, restores power and
communications, completes a purge interlock, and makes the jump home.

WebMCP is the game mechanic, not a chat feature pasted onto a game. HALCYON
keeps the partnership necessary through three rules. **Tool-gated state** means
boot, power, comms, purge, and jump state change only inside a tool execution;
the interface never offers a duplicate button. **Body-gated state** gives the
human dexterity work such as heavy drags, sustained holds, and simultaneous
controls. **Channel-split information** returns agent-only readings through
tools while human-only guidance arrives through audio and motion, never as DOM
text that would collapse the split.

The six chapters are a short, playable map of the standard. Contact teaches
**tool discovery** at the breaker panel. Manifest uses **read-only
annotations** to reveal ship damage without mutating it. Power requires
**JSON-Schema inputs and structured errors**, so an invalid routing request
coaches the agent toward the safe allocation. Antenna demonstrates **dynamic
registration and unregistration** when a human locks the dish and the ship
adds communications tools. Two-Man Rule makes a sensitive purge depend on a
**human confirmation interlock**. Burn ends with **multi-tool orchestration
with replay**: the agent coordinates the departure sequence while the flight
recorder replays the crew's run.

The novelty is that the agent is a diegetic co-player with a deliberately
different body and information channel, rather than an assistant that can
finish a conventional UI alone. A chapter-select simulator seeds prerequisites
so judges can sample any moment in minutes, and structured coaching errors turn
mistakes into another attempt instead of a dead end. The speaker panel renders
the agent's `broadcast` calls and the recorder makes each handoff inspectable.

HALCYON is a client-only static app: **No backend**, no accounts, and **zero
runtime dependencies**. It is built with Vite and TypeScript, tested with
Vitest and Playwright, and released under the **MIT** license.

- **Live URL:** OWNER PASTE-IN — deployed URL pending owner publication
- **Repository:** https://github.com/jamies-labs/halcyon
- **Video:** OWNER PASTE-IN — public video URL pending owner upload

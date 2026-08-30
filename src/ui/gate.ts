import { el } from "./dom";

export function mountGate(
  root: HTMLElement,
  crewLinkReady: Promise<boolean>,
  onStart: () => void,
): void {
  const hostStatus = el(
    "p",
    {
      class: "gate-warn",
      role: "status",
      "data-testid": "crew-link-status",
    },
    "Verifying crew link…",
  );
  void crewLinkReady.then(
    (connected) => {
      hostStatus.className = connected ? "gate-ok" : "gate-warn";
      hostStatus.textContent = connected
        ? "Crew link established. Your agent can see the ship's tools."
        : "Fallback simulator active — not a real WebMCP test. No crew link is available in this browser.";
    },
    () => {
      hostStatus.className = "gate-warn";
      hostStatus.textContent =
        "Fallback simulator active — not a real WebMCP test. No crew link is available in this browser.";
    },
  );
  const start = el(
    "button",
    { class: "gate-start", type: "button", "data-testid": "gate-start" },
    "Wake the ship",
  );
  const gate = el(
    "section",
    {
      class: "gate",
      "data-testid": "gate",
      "aria-labelledby": "gate-title",
    },
    el("p", { class: "eyebrow" }, "Emergency wake cycle"),
    el("h1", { id: "gate-title" }, "ISV HALCYON"),
    el(
      "p",
      { class: "gate-lede" },
      "A rescue for two crew: you and your agent. Neither of you can save the ship alone.",
    ),
    hostStatus,
    el(
      "p",
      { class: "gate-hint" },
      "Judging on a clock? The chapter menu up top jumps anywhere with prerequisites pre-seeded.",
    ),
    start,
  );
  start.addEventListener("click", () => {
    gate.remove();
    onStart();
  });
  root.append(gate);
}

import { el } from "./dom";

export function mountGate(
  root: HTMLElement,
  hostPresent: boolean,
  onStart: () => void,
): void {
  const hostStatus = hostPresent
    ? el(
        "p",
        { class: "gate-ok" },
        "Crew link established. Your agent can see the ship's tools.",
      )
    : el(
        "div",
        {},
        el(
          "p",
          { class: "gate-warn" },
          "No crew link. No WebMCP agent was detected in this browser.",
        ),
        el(
          "ul",
          {},
          el(
            "li",
            {},
            "Open this page in a WebMCP-compatible browser to play with an agent.",
          ),
          el(
            "li",
            {},
            "Or play solo with the crew simulator in the flight recorder.",
          ),
        ),
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
    start,
  );
  start.addEventListener("click", () => {
    gate.remove();
    onStart();
  });
  root.append(gate);
}

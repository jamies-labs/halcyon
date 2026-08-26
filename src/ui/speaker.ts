import { FAST } from "../game/timings";
import { el } from "./dom";

export class Speaker {
  private readonly feed: HTMLElement;

  constructor(root: HTMLElement) {
    this.feed = el("div", { class: "speaker-feed", "aria-live": "polite" });
    root.append(
      el("p", { class: "speaker-title" }, "Ship speaker / HALCYON"),
      this.feed,
    );
  }

  say(message: string, tone: "calm" | "urgent" | "dry" = "calm"): void {
    const line = el("p", { class: `speaker-line tone-${tone}` });
    this.feed.append(line);
    while (this.feed.children.length > 6) this.feed.firstChild?.remove();

    if (FAST) {
      line.textContent = message;
      return;
    }

    let index = 0;
    const tick = setInterval(() => {
      line.textContent = message.slice(0, ++index);
      if (index >= message.length) clearInterval(tick);
    }, 18);
  }
}

import { FAST } from "../game/timings";
import type { InvokeRecord } from "../webmcp/types";
import { el } from "./dom";
import { failureSignature, outcomeSummary } from "./outcome";

interface LastFailure {
  signature: string;
  line: HTMLElement;
  retries: number;
  message: string;
}

export class Speaker {
  private readonly feed: HTMLElement;
  private lastFailure: LastFailure | null = null;

  constructor(root: HTMLElement) {
    this.feed = el("div", { class: "speaker-feed", "aria-live": "polite" });
    root.append(
      el("p", { class: "speaker-title" }, "Ship speaker / HALCYON"),
      this.feed,
    );
  }

  say(message: string, tone: "calm" | "urgent" | "dry" = "calm"): void {
    this.lastFailure = null;
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

  record(record: InvokeRecord): void {
    const signature = failureSignature(record.tool, record.outcome);
    if (!signature) {
      this.lastFailure = null;
      return;
    }

    if (this.lastFailure?.signature === signature) {
      this.lastFailure.retries += 1;
      this.lastFailure.line.textContent = `${this.lastFailure.message} · retry ×${this.lastFailure.retries}`;
      return;
    }

    const message = `${record.tool}: ${outcomeSummary(record.outcome)}`;
    const line = el("p", { class: "speaker-line tone-urgent" }, message);
    this.feed.append(line);
    while (this.feed.children.length > 6) this.feed.firstChild?.remove();
    this.lastFailure = { signature, line, retries: 1, message };
  }
}

import type { InvokeRecord } from "../webmcp/types";
import type { ToolRegistry } from "../webmcp/registry";
import { el } from "./dom";

export interface TimelineEntry {
  t: number;
  kind: "tool" | "human";
  label: string;
  ok?: boolean;
}

export class Recorder {
  private readonly entries: TimelineEntry[] = [];
  private logElement: HTMLElement | null = null;

  record(record: InvokeRecord): void {
    this.push({
      t: record.t,
      kind: "tool",
      label: `${record.tool} (${record.source}, ${record.ms}ms)`,
      ok: record.outcome.ok,
    });
  }

  addHuman(label: string): void {
    this.push({ t: Date.now(), kind: "human", label });
  }

  getTimeline(): TimelineEntry[] {
    return [...this.entries];
  }

  attachLog(node: HTMLElement): void {
    this.logElement = node;
    for (const entry of this.entries) this.render(entry);
  }

  private push(entry: TimelineEntry): void {
    this.entries.push(entry);
    this.render(entry);
  }

  private render(entry: TimelineEntry): void {
    if (!this.logElement) return;
    const kindClass =
      entry.kind === "human"
        ? "rec-human"
        : entry.ok === false
          ? "rec-err"
          : "rec-tool";
    this.logElement.append(
      el(
        "p",
        { class: `rec-line ${kindClass}` },
        `${new Date(entry.t).toLocaleTimeString()} ${entry.label}`,
      ),
    );
    this.logElement.scrollTop = this.logElement.scrollHeight;
  }
}

export function mountRecorderPanel(
  recorder: Recorder,
  registry: ToolRegistry,
  container: HTMLElement,
): void {
  const log = el("div", { class: "rec-log", "data-testid": "recorder-log" });
  const select = el("select", {
    "data-testid": "sim-tool-select",
    "aria-label": "Simulator tool",
  });
  const args = el("textarea", {
    class: "sim-args",
    "data-testid": "sim-args",
    rows: "3",
    "aria-label": "Tool arguments as JSON",
  });
  args.value = "{}";
  const refresh = () => {
    select.replaceChildren(
      ...registry
        .listTools()
        .map((tool) => el("option", { value: tool.name }, tool.name)),
    );
  };
  const invokeButton = el(
    "button",
    { class: "sim-invoke", type: "button", "data-testid": "sim-invoke" },
    "Invoke selected tool",
  );
  invokeButton.addEventListener("click", () => {
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(args.value || "{}");
    } catch {
      recorder.addHuman("Simulator rejected invalid JSON arguments.");
      return;
    }
    void registry.invoke(select.value, parsed, "sim");
  });
  const close = el(
    "button",
    {
      class: "recorder-close",
      type: "button",
      "data-testid": "recorder-close",
    },
    "Close flight recorder",
  );
  const panel = el(
    "aside",
    {
      class: "recorder-panel hidden",
      "data-testid": "recorder-panel",
      "aria-label": "Flight recorder and crew simulator",
      "aria-hidden": "true",
      hidden: "",
    },
    el(
      "div",
      { class: "recorder-heading" },
      el("h2", { class: "rec-title" }, "Flight recorder / crew simulator"),
      close,
    ),
    log,
    el("div", { class: "sim-form" }, select, args, invokeButton),
  );
  recorder.attachLog(log);
  const toggle = el(
    "button",
    {
      class: "recorder-toggle",
      type: "button",
      "data-testid": "recorder-toggle",
      "aria-controls": "recorder-panel",
      "aria-expanded": "false",
    },
    "Open flight recorder",
  );
  panel.id = "recorder-panel";
  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    panel.classList.toggle("hidden", !open);
    panel.setAttribute("aria-hidden", String(!open));
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open
      ? "Close flight recorder"
      : "Open flight recorder";
    if (open) refresh();
  };
  toggle.addEventListener("click", () => {
    const open = panel.hidden;
    setOpen(open);
    if (!open) toggle.focus();
  });
  close.addEventListener("click", () => {
    setOpen(false);
    toggle.focus();
  });
  const dock = el(
    "section",
    { class: "recorder-dock", "aria-label": "Flight recorder controls" },
    toggle,
    panel,
  );
  container.insertBefore(dock, container.querySelector(".stage"));
}

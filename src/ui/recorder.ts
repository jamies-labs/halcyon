import type { InvokeRecord } from "../webmcp/types";
import type { ToolRegistry } from "../webmcp/registry";
import { el } from "./dom";
import { failureSignature, outcomeSummary } from "./outcome";

export interface TimelineEntry {
  t: number;
  kind: "tool" | "human";
  label: string;
  ok?: boolean;
  outcome?: string;
  failureKey?: string;
  retries?: number;
}

export class Recorder {
  private readonly entries: TimelineEntry[] = [];
  private logElement: HTMLElement | null = null;

  record(record: InvokeRecord): void {
    const failureKey = failureSignature(record.tool, record.outcome);
    const previous = this.entries.at(-1);
    if (failureKey && previous?.failureKey === failureKey) {
      previous.retries = (previous.retries ?? 1) + 1;
      this.renderAll();
      return;
    }
    this.push({
      t: record.t,
      kind: "tool",
      label: `${record.tool} (${record.source}, ${record.ms}ms)`,
      ok: record.outcome.ok,
      outcome: outcomeSummary(record.outcome),
      failureKey: failureKey ?? undefined,
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
    this.renderAll();
  }

  private push(entry: TimelineEntry): void {
    this.entries.push(entry);
    this.renderAll();
  }

  private renderAll(): void {
    if (!this.logElement) return;
    this.logElement.replaceChildren(
      ...this.entries.map((entry) => this.render(entry)),
    );
    this.logElement.scrollTop = this.logElement.scrollHeight;
  }

  private render(entry: TimelineEntry): HTMLElement {
    const kindClass =
      entry.kind === "human"
        ? "rec-human"
        : entry.ok === false
          ? "rec-err"
          : "rec-tool";
    const retry =
      entry.retries && entry.retries > 1 ? ` · retry ×${entry.retries}` : "";
    return el(
      "p",
      { class: `rec-line ${kindClass}` },
      `${new Date(entry.t).toLocaleTimeString()} ${entry.label}${entry.outcome ? ` · ${entry.outcome}` : ""}${retry}`,
    );
  }
}

export function mountRecorderPanel(
  recorder: Recorder,
  registry: ToolRegistry,
  container: HTMLElement,
): void {
  const log = el("div", { class: "rec-log", "data-testid": "recorder-log" });
  const recorderClose = el(
    "button",
    {
      class: "recorder-close",
      type: "button",
      "data-testid": "recorder-close",
    },
    "Close flight recorder",
  );
  const recorderPanel = el(
    "aside",
    {
      class: "recorder-panel hidden",
      "data-testid": "recorder-panel",
      "aria-label": "Flight recorder — mission history (optional)",
      "aria-hidden": "true",
      hidden: "",
    },
    el(
      "div",
      { class: "recorder-heading" },
      el("h2", { class: "rec-title" }, "Flight recorder — mission history"),
      recorderClose,
    ),
    log,
  );
  recorderPanel.id = "recorder-panel";
  const recorderToggle = el(
    "button",
    {
      class: "recorder-toggle",
      type: "button",
      "data-testid": "recorder-toggle",
      "aria-controls": "recorder-panel",
      "aria-expanded": "false",
    },
    "Flight recorder — mission history (optional)",
  );

  const select = el("select", {
    "data-testid": "sim-tool-select",
    "aria-label": "Test console tool",
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
  registry.subscribe(refresh);
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
  const consoleClose = el(
    "button",
    {
      class: "test-console-close",
      type: "button",
      "data-testid": "test-console-close",
    },
    "Close test console",
  );
  const consolePanel = el(
    "aside",
    {
      class: "test-console-panel hidden",
      "data-testid": "test-console-panel",
      "aria-label": "Test console (optional — not part of normal play)",
      "aria-hidden": "true",
      hidden: "",
    },
    el(
      "div",
      { class: "recorder-heading" },
      el(
        "h2",
        { class: "rec-title" },
        "Test console (optional — not part of normal play)",
      ),
      consoleClose,
    ),
    el("div", { class: "sim-form" }, select, args, invokeButton),
  );
  recorder.attachLog(log);
  consolePanel.id = "test-console-panel";
  const consoleToggle = el(
    "button",
    {
      class: "test-console-toggle",
      type: "button",
      "data-testid": "test-console-toggle",
      "aria-controls": "test-console-panel",
      "aria-expanded": "false",
    },
    "Test console (optional — not part of normal play)",
  );
  const setOpen = (
    panel: HTMLElement,
    toggle: HTMLElement,
    open: boolean,
  ): void => {
    panel.hidden = !open;
    panel.classList.toggle("hidden", !open);
    panel.setAttribute("aria-hidden", String(!open));
    toggle.setAttribute("aria-expanded", String(open));
  };
  recorderToggle.addEventListener("click", () => {
    const open = recorderPanel.hidden;
    setOpen(recorderPanel, recorderToggle, open);
    if (!open) recorderToggle.focus();
  });
  recorderClose.addEventListener("click", () => {
    setOpen(recorderPanel, recorderToggle, false);
    recorderToggle.focus();
  });
  consoleToggle.addEventListener("click", () => {
    const open = consolePanel.hidden;
    setOpen(consolePanel, consoleToggle, open);
    if (open) refresh();
    else consoleToggle.focus();
  });
  consoleClose.addEventListener("click", () => {
    setOpen(consolePanel, consoleToggle, false);
    consoleToggle.focus();
  });
  const dock = el(
    "section",
    {
      class: "recorder-dock",
      "aria-label": "Optional mission history and test console",
    },
    recorderToggle,
    consoleToggle,
    recorderPanel,
    consolePanel,
  );
  container.insertBefore(dock, container.querySelector(".stage"));
}

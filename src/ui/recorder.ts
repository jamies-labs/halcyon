import type { InvokeRecord, ToolDef, ToolOutcome } from "../webmcp/types";
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

type Schema = Record<string, unknown>;
const AGENT_ONLY_RESULT_FIELDS = new Set(["agent_only", "jump_vector"]);

function exampleValue(schema: Schema): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.includes("s2") ? "s2" : schema.enum[0];
  }

  switch (schema.type) {
    case "object": {
      const properties = (schema.properties ?? {}) as Record<string, Schema>;
      const required = (schema.required ?? Object.keys(properties)) as string[];
      return Object.fromEntries(
        required
          .filter((name) => name in properties)
          .map((name) => [name, exampleValue(properties[name]!)]),
      );
    }
    case "array": {
      const count = typeof schema.minItems === "number" ? schema.minItems : 0;
      return Array.from({ length: count }, () =>
        exampleValue((schema.items ?? {}) as Schema),
      );
    }
    case "integer":
    case "number":
      return typeof schema.minimum === "number" ? schema.minimum : 0;
    case "boolean":
      return false;
    case "string": {
      const minimum =
        typeof schema.minLength === "number" ? schema.minLength : 0;
      const maximum =
        typeof schema.maxLength === "number" ? schema.maxLength : undefined;
      const length = Math.min(Math.max(1, minimum), maximum ?? Infinity);
      return "x".repeat(length);
    }
    default:
      return "";
  }
}

function editableExample(tool: ToolDef): string {
  return JSON.stringify(exampleValue(tool.inputSchema));
}

function recorderSafeData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(recorderSafeData);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !AGENT_ONLY_RESULT_FIELDS.has(key))
      .map(([key, child]) => [key, recorderSafeData(child)]),
  );
}

function renderField(label: string, value: string): HTMLElement {
  return el(
    "div",
    { class: "sim-result-field" },
    el("dt", {}, label),
    el("dd", {}, value),
  );
}

function renderDetails(
  tool: ToolDef | undefined,
  target: HTMLElement,
  args: HTMLTextAreaElement,
  resetExample: boolean,
): void {
  if (!tool) {
    target.replaceChildren(
      el(
        "p",
        { class: "sim-empty" },
        "No live tools are registered for this chapter.",
      ),
    );
    if (resetExample) args.value = "{}";
    return;
  }

  if (resetExample) args.value = editableExample(tool);
  const historicalContract =
    tool.name === "flag_section"
      ? el(
          "p",
          { class: "sim-contract-note" },
          'Use section_id and priority. The historical inputs {"section":"S3"}, {"section":"S6"}, {"section":3}, and {"section":6} use the obsolete section field and are invalid.',
        )
      : null;
  target.replaceChildren(
    el("p", { class: "sim-tool-name" }, tool.name),
    el("p", { class: "sim-description" }, tool.description),
    el("h3", { class: "sim-subheading" }, "Input schema"),
    el(
      "pre",
      { class: "sim-schema" },
      JSON.stringify(tool.inputSchema, null, 2),
    ),
    ...(historicalContract ? [historicalContract] : []),
  );
}

function renderResult(outcome: ToolOutcome, target: HTMLElement): void {
  const fields: HTMLElement[] = [renderField("ok", `=${String(outcome.ok)}`)];
  if (outcome.ok) {
    fields.push(
      renderField(
        "state consequence",
        outcome.state_consequence ??
          "No state consequence reported by this tool.",
      ),
      el(
        "div",
        { class: "sim-result-data" },
        el("dt", {}, "returned data"),
        el(
          "dd",
          {},
          el(
            "pre",
            {},
            JSON.stringify(recorderSafeData(outcome.data), null, 2),
          ),
        ),
      ),
    );
  } else {
    fields.push(
      renderField("code", outcome.code),
      renderField("detail", outcome.detail),
      renderField("hint", outcome.hint),
    );
  }
  if (outcome.human_action)
    fields.push(renderField("human action", outcome.human_action));
  if (outcome.wait_for) fields.push(renderField("wait for", outcome.wait_for));
  if (!outcome.ok) {
    fields.push(
      renderField(
        "state consequence",
        outcome.state_consequence ??
          "No state change reported by this failed tool call.",
      ),
    );
  }
  target.replaceChildren(
    el("h3", { class: "sim-subheading" }, "Latest outcome"),
    el("dl", { class: "sim-result-fields" }, ...fields),
  );
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
  recorder.attachLog(log);
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

  const consoleBody = el("div", {
    class: "test-console-body",
    "data-testid": "test-console-body",
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
    consoleBody,
  );
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

  let refreshConsole: (() => void) | null = null;
  const ensureConsoleMounted = (): void => {
    if (refreshConsole) return;

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
    const details = el("section", {
      class: "sim-tool-details",
      "data-testid": "sim-tool-details",
      "aria-label": "Selected test console tool details",
    });
    const result = el("section", {
      class: "sim-result",
      "data-testid": "sim-result",
      "aria-label": "Latest test console result",
      "aria-live": "polite",
    });
    const invokeButton = el(
      "button",
      { class: "sim-invoke", type: "button", "data-testid": "sim-invoke" },
      "Invoke selected tool",
    );

    refreshConsole = () => {
      const selectedName = select.value;
      const tools = registry.listTools();
      select.replaceChildren(
        ...tools.map((tool) => el("option", { value: tool.name }, tool.name)),
      );
      const selected =
        tools.find((tool) => tool.name === selectedName) ?? tools[0];
      select.value = selected?.name ?? "";
      renderDetails(selected, details, args, selected?.name !== selectedName);
    };
    registry.subscribe(() => refreshConsole?.());
    select.addEventListener("change", () => {
      renderDetails(
        registry.listTools().find((tool) => tool.name === select.value),
        details,
        args,
        true,
      );
    });
    invokeButton.addEventListener("click", () => {
      let parsed: unknown = {};
      try {
        parsed = JSON.parse(args.value || "{}");
      } catch (error) {
        renderResult(
          {
            ok: false,
            code: "INVALID_JSON",
            detail:
              error instanceof Error
                ? error.message
                : "Arguments are not valid JSON.",
            hint: "Correct the JSON syntax, then invoke the tool again.",
          },
          result,
        );
        return;
      }
      void registry.invoke(select.value, parsed, "sim").then((record) => {
        renderResult(record.outcome, result);
      });
    });
    consoleBody.append(
      el("div", { class: "sim-form" }, select, details, args, invokeButton),
      result,
    );
    refreshConsole();
  };

  const setOpen = (
    panel: HTMLElement,
    toggle: HTMLButtonElement,
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
    if (open) ensureConsoleMounted();
    setOpen(consolePanel, consoleToggle, open);
    if (!open) consoleToggle.focus();
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
    el("div", { class: "optional-surface-controls" }, recorderToggle, consoleToggle),
    recorderPanel,
    consolePanel,
  );
  container.insertBefore(dock, container.querySelector(".stage"));
}

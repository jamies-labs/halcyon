import type { ToolOutcome } from "../webmcp/types";

function compactValue(value: unknown): string {
  if (value === null) return "none";
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (typeof value === "string") return "text";
  if (Array.isArray(value)) return `${value.length} items`;
  return "{…}";
}

export function compactDataSummary(data: unknown): string {
  if (data === null || typeof data !== "object") return compactValue(data);
  if (Array.isArray(data)) return `${data.length} items`;

  const fields = Object.entries(data);
  const visible = fields
    .slice(0, 3)
    .map(([name, value]) => `${name}=${compactValue(value)}`);
  const hiddenCount = fields.length - visible.length;
  return `${visible.join("; ")}${hiddenCount > 0 ? `; +${hiddenCount} fields` : ""}`;
}

export function outcomeSummary(outcome: ToolOutcome): string {
  if (outcome.ok) return `ok=true · data: ${compactDataSummary(outcome.data)}`;
  return `ok=false · ${outcome.code} · ${outcome.detail} · hint: ${outcome.hint}`;
}

export function failureSignature(
  tool: string,
  outcome: ToolOutcome,
): string | null {
  if (outcome.ok) return null;
  return [tool, outcome.code, outcome.detail, outcome.hint].join("\u0000");
}

// The ONLY file that touches the WebMCP browser API.
// Covers: document.modelContext (standard + ChatGPT), navigator.modelContext
// (older Chromium builds), registerTool with {signal} (standard) or a returned
// handle carrying unregister() (defensive).
export interface HostToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute(args: Record<string, unknown>): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>;
}
export interface HostRegistration { abort(): void }
export interface ModelContextHost { register(tool: HostToolDescriptor): HostRegistration }

export function detectModelContext(): ModelContextHost | null {
  const mc =
    (document as unknown as { modelContext?: unknown }).modelContext ??
    (navigator as unknown as { modelContext?: unknown }).modelContext;
  const api = mc as { registerTool?: (t: unknown, o?: unknown) => unknown } | undefined;
  if (!api || typeof api.registerTool !== 'function') return null;
  return {
    register(tool) {
      const ctrl = new AbortController();
      let handle: unknown;
      try {
        handle = api.registerTool!(tool, { signal: ctrl.signal });
      } catch {
        handle = api.registerTool!(tool);
      }
      return {
        abort() {
          ctrl.abort();
          const h = handle as { unregister?: () => void; then?: (fn: (r: { unregister?: () => void } | undefined) => void) => void } | undefined;
          if (h && typeof h.then === 'function') h.then((r) => r?.unregister?.());
          else h?.unregister?.();
        },
      };
    },
  };
}

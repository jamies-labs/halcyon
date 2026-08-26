// The only module that accesses WebMCP browser APIs. It tolerates the current
// document API and the older navigator API used by early browser builds.
export interface HostToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute(args: Record<string, unknown>): Promise<{
    content: { type: "text"; text: string }[];
    isError?: boolean;
  }>;
}

export interface HostRegistration {
  abort(): void;
}

export interface ModelContextHost {
  register(tool: HostToolDescriptor): HostRegistration;
}

interface RegistrationHandle {
  unregister?: () => void;
}

interface ModelContextApi {
  registerTool?: (
    tool: HostToolDescriptor,
    options?: { signal: AbortSignal },
  ) => RegistrationHandle | Promise<RegistrationHandle | undefined> | undefined;
}

export function detectModelContext(): ModelContextHost | null {
  const modelContext =
    (typeof document === "undefined"
      ? undefined
      : (document as Document & { modelContext?: unknown }).modelContext) ??
    (typeof navigator === "undefined"
      ? undefined
      : (navigator as Navigator & { modelContext?: unknown }).modelContext);
  const api = modelContext as ModelContextApi | undefined;
  if (!api || typeof api.registerTool !== "function") return null;

  return {
    register(tool) {
      const controller = new AbortController();
      let registration:
        | RegistrationHandle
        | Promise<RegistrationHandle | undefined>
        | undefined;
      try {
        registration = api.registerTool!(tool, { signal: controller.signal });
      } catch {
        registration = api.registerTool!(tool);
      }

      return {
        abort() {
          controller.abort();
          if (
            registration &&
            typeof (registration as Promise<RegistrationHandle>).then ===
              "function"
          ) {
            void (registration as Promise<RegistrationHandle | undefined>).then(
              (handle) => handle?.unregister?.(),
            );
          } else {
            (registration as RegistrationHandle | undefined)?.unregister?.();
          }
        },
      };
    },
  };
}

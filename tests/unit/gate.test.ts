import { describe, expect, it, vi } from "vitest";
import { mountGate } from "../../src/ui/gate";

class FakeTextNode {
  constructor(readonly textContent: string) {}
}

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  className = "";
  textContent = "";

  append(...children: Array<FakeElement | FakeTextNode>): void {
    for (const child of children) {
      if (child instanceof FakeElement) this.children.push(child);
      this.textContent += child.textContent;
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(): void {}

  remove(): void {}
}

function statusIn(root: FakeElement): FakeElement {
  const gate = root.children[0];
  const status = gate?.children.find(
    (child) => child.attributes.get("data-testid") === "crew-link-status",
  );
  if (!status) throw new Error("crew-link status was not mounted");
  return status;
}

describe("mountGate", () => {
  it("keeps the crew-link status accessible through verification and every settled outcome", async () => {
    vi.stubGlobal("document", {
      createElement: () => new FakeElement(),
      createTextNode: (text: string) => new FakeTextNode(text),
    } as unknown as Document);

    try {
      const states = [
        {
          readiness: () => Promise.resolve(true),
          expected:
            "Crew link established. Your agent can see the ship's tools.",
        },
        {
          readiness: () => Promise.resolve(false),
          expected:
            "Fallback simulator active — not a real WebMCP test. No crew link is available in this browser.",
        },
        {
          readiness: () =>
            Promise.reject(new Error("host registration declined")),
          expected:
            "Fallback simulator active — not a real WebMCP test. No crew link is available in this browser.",
        },
      ];

      for (const { readiness, expected } of states) {
        const root = new FakeElement();
        mountGate(root as unknown as HTMLElement, readiness(), () => {});
        const status = statusIn(root);

        expect(
          status.textContent,
          "the pending state must identify itself",
        ).toBe("Verifying crew link…");
        expect(
          status.attributes.get("aria-label"),
          "the pending status must have the same accessible name as its visible text",
        ).toBe("Verifying crew link…");

        await Promise.resolve();

        expect(
          status.textContent,
          "the visible settled status must be exact",
        ).toBe(expected);
        expect(
          status.attributes.get("aria-label"),
          "the settled accessible name must match the visible crew-link result",
        ).toBe(expected);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

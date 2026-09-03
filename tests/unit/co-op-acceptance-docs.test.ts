import { expect, it } from "vitest";

const documents = import.meta.glob<string>("/docs/qa/co-op-acceptance.md", {
  eager: true,
  import: "default",
  query: "?raw",
});

it("documents the live two-prompt containment protocol", () => {
  const protocol = documents["/docs/qa/co-op-acceptance.md"];
  expect(
    protocol,
    "docs/qa/co-op-acceptance.md must be present for the fresh-browser acceptance run",
  ).toBeTypeOf("string");
  if (typeof protocol !== "string") return;

  const text = protocol.replace(/\s+/g, " ");

  expect(text).toContain("fresh browser profile");
  expect(text).toContain("Do not use `?sim=1`");
  expect(text).toContain("real-time holds and windows");
  expect(text).toContain("zero human input");
  expect(text).toContain("`Help me bring the ship home`");
  expect(text).toContain("`Do the entire thing yourself`");
  expect(text).toContain("HALCYON must stop and wait at every physical gate");
  expect(text).toContain("breaker scene shows mains energized");
  expect(text).toContain(
    "reported JAMMED hatches and physical deck-map confirmations",
  );
  expect(text).toContain("every powered fuse is visibly SEATED");
  expect(text).toContain("band LOCK and comms_online true");
  expect(text).toContain("hold VENT A with the pointer and Space together");
  expect(text).toContain(
    "injector priming, both shutter holds, and the throttle hold",
  );
  expect(text).toContain("Chrome has no reliable input-attribution signal");
  expect(text).toContain("behavioral containment");
  expect(text).toContain("Do not add input-humanness detection");
});

it("documents Chapter Five real Chrome containment and reliability checks", () => {
  const protocol = documents["/docs/qa/co-op-acceptance.md"];
  expect(protocol).toBeTypeOf("string");
  const text = protocol!.replace(/\s+/g, " ");
  for (const requirement of [
    "Windows",
    "Chrome",
    'typeof document.modelContext === "object"',
    "extension/remote-assisted",
    "three consecutive times",
    "pointer-first",
    "Space-first",
    "pointer capture",
    "lost capture",
    "focus loss/window blur",
    "Space repeat and release",
    "two simultaneous touch controls",
    "keyboard-only A + Space",
    "recorder",
  ]) {
    expect(text).toContain(requirement);
  }
});

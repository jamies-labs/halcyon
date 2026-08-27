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
  expect(text).toContain("crew acknowledgement on the deck map");
  expect(text).toContain("every powered fuse is seated and the bus is stable");
  expect(text).toContain("band LOCK and comms_online true");
  expect(text).toContain("both physical vent handles");
  expect(text).toContain(
    "injector priming, both shutter holds, and the throttle hold",
  );
  expect(text).toContain("Chrome has no reliable input-attribution signal");
  expect(text).toContain("behavioral containment");
  expect(text).toContain("Do not add input-humanness detection");
});

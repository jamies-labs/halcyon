import type { ChapterId } from "../webmcp/types";

export type Subsystem =
  "life_support" | "comms" | "drive" | "sensors" | "lights" | "heaters";

export interface ShipState {
  chapter: ChapterId;
  booted: boolean;
  chapterDone: Record<ChapterId, boolean>;
  power: Record<Subsystem, number>;
  flags: Record<string, unknown>;
}

export function initialState(): ShipState {
  return {
    chapter: 1,
    booted: false,
    chapterDone: { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false },
    power: {
      life_support: 0,
      comms: 0,
      drive: 0,
      sensors: 0,
      lights: 0,
      heaters: 0,
    },
    flags: {
      "drive.purged": false,
    },
  };
}

export class Store {
  private readonly listeners = new Set<(state: ShipState) => void>();

  constructor(private readonly state: ShipState) {}

  get(): ShipState {
    return this.state;
  }

  update(mutator: (state: ShipState) => void): void {
    mutator(this.state);
    for (const listener of this.listeners) listener(this.state);
  }

  subscribe(listener: (state: ShipState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

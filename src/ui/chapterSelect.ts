import type { ChapterId } from "../webmcp/types";
import { FLAGS } from "../game/chapters/types";
import type { Store } from "../game/store";
import { el } from "./dom";

export function seedForChapter(store: Store, chapter: ChapterId): void {
  store.update((state) => {
    state.chapter = chapter;
    state.campaignChapter = chapter;
    if (chapter >= 2) state.booted = true;
    if (chapter > 2) state.flags[FLAGS.manifestFlagged] = ["s2", "s4", "s5"];
    if (chapter > 3) {
      state.power = {
        life_support: 18,
        comms: 8,
        drive: 14,
        sensors: 6,
        lights: 4,
        heaters: 0,
      };
      state.flags[FLAGS.powerRouted] = true;
    }
    if (chapter > 4) {
      state.flags[FLAGS.commsOnline] = true;
      state.flags[FLAGS.jumpVector] = { x: 0.42, y: -1.07, z: 3.14 };
    }
    if (chapter > 5) state.flags[FLAGS.drivePurged] = true;
    for (
      let prior = 1 as ChapterId;
      prior < chapter;
      prior = (prior + 1) as ChapterId
    ) {
      state.chapterDone[prior] = true;
    }
  });
}

export function selectChapter(
  store: Store,
  chapter: ChapterId,
  isSimulatorSession: boolean,
): void {
  if (isSimulatorSession) {
    seedForChapter(store, chapter);
    return;
  }
  const state = store.get();
  if (chapter > state.campaignChapter) return;
  store.update((next) => {
    next.chapter = chapter;
  });
}

export function mountChapterSelect(
  container: HTMLElement,
  store: Store,
  titles: Record<ChapterId, string>,
  isSimulatorSession: boolean,
): void {
  const menu = el("nav", {
    class: "chapter-select",
    "data-testid": "chapter-select",
    "aria-label": isSimulatorSession
      ? "Training simulator chapter selector"
      : "Campaign chapter selector",
  });
  if (isSimulatorSession) {
    menu.append(
      el(
        "p",
        { class: "chapter-select-mode", "data-testid": "simulator-session" },
        "TRAINING SIMULATION — prerequisites are temporary.",
      ),
    );
  }
  for (const id of [1, 2, 3, 4, 5, 6] as ChapterId[]) {
    const button = el(
      "button",
      { type: "button", "data-testid": `goto-ch${id}` },
      `${id}. ${titles[id]}`,
    );
    button.addEventListener("click", () =>
      selectChapter(store, id, isSimulatorSession),
    );
    const refresh = () => {
      button.disabled = !isSimulatorSession && id > store.get().campaignChapter;
    };
    refresh();
    store.subscribe(refresh);
    menu.append(button);
  }
  container.append(menu);
}

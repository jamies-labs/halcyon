import "./styles.css";
import { AudioEngine } from "./audio/engine";
import { CHAPTERS } from "./game/chapters";
import type { Chapter, ChapterCtx } from "./game/chapters/types";
import { globalTools } from "./game/globalTools";
import { bindAutosave, loadSave, restoreCampaign } from "./game/save";
import { initialState, isSimulatorSession, Store } from "./game/store";
import { T } from "./game/timings";
import {
  seedForChapter,
  mountChapterSelect,
  selectChapter,
} from "./ui/chapterSelect";
import { el } from "./ui/dom";
import { mountGate } from "./ui/gate";
import { mountRecorderPanel, Recorder } from "./ui/recorder";
import { Speaker } from "./ui/speaker";
import { ToolRegistry } from "./webmcp/registry";
import { detectModelContext } from "./webmcp/shim";
import type { ChapterId } from "./webmcp/types";

const params = new URLSearchParams(location.search);
const simulatorSession = isSimulatorSession(location.search);
const app = document.querySelector<HTMLDivElement>("#app")!;
const store = new Store(initialState());
if (!simulatorSession) {
  const saved = loadSave();
  if (saved) restoreCampaign(store, saved);
  bindAutosave(store);
}

const recorder = new Recorder();
const host = detectModelContext();
const registry = new ToolRegistry(host, (record) => recorder.record(record));
const audio = new AudioEngine();
const titles: Record<ChapterId, string> = {
  1: "Contact",
  2: "Manifest",
  3: "Power",
  4: "Antenna",
  5: "Two-person rule",
  6: "Burn",
};

const header = el(
  "header",
  { class: "hud" },
  el("p", { class: "hud-title" }, "ISV HALCYON"),
  el("p", { class: "hud-chapter", "data-testid": "hud-chapter" }),
);
const stage = el("main", { class: "stage", "data-testid": "stage" });
const speakerRoot = el("section", {
  class: "speaker",
  "data-testid": "speaker-panel",
  "aria-label": "Ship speaker",
});
app.replaceChildren(header, stage, speakerRoot);
const speaker = new Speaker(speakerRoot);
mountRecorderPanel(recorder, registry, app);
mountChapterSelect(header, store, titles, simulatorSession);

let mounted: Chapter | null = null;
function contextFor(chapter: Chapter): ChapterCtx {
  return {
    isSimulatorSession: simulatorSession,
    store,
    registry,
    audio,
    speaker,
    recorder,
    stage,
    complete() {
      store.update((state) => {
        state.chapterDone[chapter.id] = true;
      });
      recorder.addHuman(`Chapter ${chapter.id} (${chapter.title}) complete.`);
      if (chapter.id < 6) {
        setTimeout(() => {
          store.update((state) => {
            const nextChapter = (chapter.id + 1) as ChapterId;
            state.chapter = nextChapter;
            if (state.campaignChapter < nextChapter) {
              state.campaignChapter = nextChapter;
            }
          });
        }, T.advanceDelayMs);
      }
    },
  };
}

function mountChapter(id: ChapterId): void {
  mounted?.unmount();
  stage.replaceChildren();
  header.querySelector<HTMLElement>(".hud-chapter")!.textContent =
    `Chapter ${id} / ${titles[id]}`;
  const chapter = CHAPTERS[id];
  if (!chapter) {
    stage.append(
      el(
        "section",
        {
          class: "chapter-missing",
          "data-testid": "chapter-missing",
          "aria-live": "polite",
        },
        el("p", { class: "eyebrow" }, "Chapter router"),
        el("h1", {}, `Chapter ${id} is under construction.`),
        el("p", {}, "The crew surface is ready for this chapter's real scene."),
      ),
    );
    mounted = null;
    registry.setTools(store.get().booted ? globalTools(store, speaker) : []);
    return;
  }
  mounted = chapter;
  const context = contextFor(chapter);
  const baseTools = store.get().booted ? globalTools(store, speaker) : [];
  registry.setTools([...baseTools, ...chapter.tools(context)]);
  chapter.mount(context);
}

let lastChapter: ChapterId | null = null;
store.subscribe((state) => {
  if (state.chapter !== lastChapter) {
    lastChapter = state.chapter;
    mountChapter(state.chapter);
  }
});

const requestedChapter = Number(params.get("ch")) as ChapterId;
if (simulatorSession && requestedChapter >= 1 && requestedChapter <= 6) {
  seedForChapter(store, requestedChapter);
} else {
  lastChapter = store.get().chapter;
  mountChapter(lastChapter);
}

if (simulatorSession) {
  audio.ensureRunning();
} else {
  mountGate(app, host !== null, () => {
    audio.ensureRunning();
    speaker.say(
      "Emergency power detected. Hello, crew. Let's go home.",
      "calm",
    );
  });
}

window.halcyonSim = {
  invoke: (name: string, args?: unknown) =>
    registry.invoke(name, args ?? {}, "sim"),
  listTools: () => registry.listTools().map((tool) => tool.name),
  getState: () => store.get(),
  goto: (chapter: ChapterId) => selectChapter(store, chapter, simulatorSession),
};

declare global {
  interface Window {
    halcyonSim: {
      invoke: (name: string, args?: unknown) => Promise<unknown>;
      listTools: () => string[];
      getState: () => ReturnType<Store["get"]>;
      goto: (chapter: ChapterId) => void;
    };
  }
}

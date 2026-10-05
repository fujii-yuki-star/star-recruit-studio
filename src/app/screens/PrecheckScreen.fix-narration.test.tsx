// @vitest-environment jsdom
// 公開前チェックの「セリフの長さ」「早口になる場面」から、その場面のセリフ欄へ寄り、AI 補助の候補をすぐ出す（ADR-0053 決定2）。
//
// ⚠️ **公開前チェックと場面編集を続けて動かす**＝片方だけを見ると「印は置いたが受け手が読まない」「受け手は読むが誰も置かない」が緑のまま通る。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MAX_NARRATION_LEN_DEFAULT, MAX_SUBTITLE_LEN_DEFAULT } from "../../domain/constants";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { saveSectionOpen, SECTION_SCOPE } from "../components/sectionOpen";
import { ASSIST_KIND } from "../../domain/ai/assist";
import type { Scene } from "../../domain/project/types";

const ai = vi.hoisted(() => ({ available: true, calls: [] as string[] }));
vi.mock("../../infrastructure/aiClient", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  localAiAvailable: () => Promise.resolve(ai.available),
  localAiAssist: (system: string) => {
    ai.calls.push(system);
    return Promise.resolve(JSON.stringify({ candidates: ["短くした候補です。"] }));
  },
}));

import { useProjectStore } from "../store/projectStore";
import { resetAiSuggestAvailabilityForTest } from "../components/AiSuggest";
import { PrecheckScreen } from "./PrecheckScreen";
import { SceneEditScreen } from "./SceneEditScreen";
import { FIX_NARRATION_ACTION_LABEL } from "../uiLabels";

const scene = (sceneId: string, text: string, durationSec = 8): Scene =>
  ({
    sceneId, partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text, status: "generated" }, warnings: [],
  }) as Scene;

const flush = () => act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });

beforeEach(() => {
  cleanup();
  resetAiSuggestAvailabilityForTest();
  ai.available = true;
  ai.calls = [];
  useProjectStore.getState().setExportRun({ phase: "idle" });
  useProjectStore.getState().newProject();
  useProjectStore.setState({
    status: "ready",
    scenes: [scene("scene_001", "短い。"), scene("scene_002", "あ".repeat(MAX_NARRATION_LEN_DEFAULT + 1), 20)],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001", "scene_002"] }],
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
});

describe("公開前チェックから AI 補助へ（ADR-0053 決定2）", () => {
  it("「セリフを直す」で該当場面を開き、セリフ欄へ寄せ、「短く」を頼む印を置く", () => {
    const onNavigate = vi.fn();
    render(<PrecheckScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: FIX_NARRATION_ACTION_LABEL }));
    expect(onNavigate).toHaveBeenCalledWith("scene-edit");
    const st = useProjectStore.getState();
    expect(st.editingSceneId).toBe("scene_002");
    expect(st.editingSceneFocus).toBe("narration");
    expect(st.editingSceneAssist).toBe(ASSIST_KIND.shorten);
  });

  it("早口になる場面からは「表示時間に収める」を頼む印を置く", () => {
    useProjectStore.setState({ scenes: [scene("scene_001", "短い。"), scene("scene_002", "い".repeat(40), 3)] });
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: FIX_NARRATION_ACTION_LABEL }));
    expect(useProjectStore.getState().editingSceneId).toBe("scene_002");
    expect(useProjectStore.getState().editingSceneAssist).toBe(ASSIST_KIND.fitDuration);
  });

  it("場面編集は印を受けて1回だけ頼み、印を消す（候補は「使う」まで当てない）", async () => {
    useProjectStore.setState({ editingSceneId: "scene_002", editingSceneFocus: "narration", editingSceneAssist: ASSIST_KIND.shorten });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    await flush();
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]).toContain("短く");
    expect(useProjectStore.getState().editingSceneAssist).toBeNull();
    expect(screen.getByText("短くした候補です。")).toBeInTheDocument();
    expect(useProjectStore.getState().scenes[1].narration.text).toBe("あ".repeat(MAX_NARRATION_LEN_DEFAULT + 1));
  });

  it("掛け合いの場面への印は受けず、消す（後で掛け合いを解いても勝手に頼まない）", async () => {
    const dlg = { ...scene("scene_002", ""), lines: [{ lineId: "line_001", text: "え".repeat(MAX_NARRATION_LEN_DEFAULT + 1) }] } as Scene;
    useProjectStore.setState({ scenes: [scene("scene_001", "短い。"), dlg], editingSceneId: "scene_002", editingSceneAssist: ASSIST_KIND.shorten });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    await flush();
    expect(useProjectStore.getState().editingSceneAssist).toBeNull();
    // 掛け合いを解いて一人語りに戻しても頼まない。
    act(() => {
      useProjectStore.setState((st) => ({ scenes: st.scenes.map((s) => (s.sceneId === "scene_002" ? { ...s, lines: undefined, narration: { text: "お".repeat(MAX_NARRATION_LEN_DEFAULT + 1), status: "none" } } as Scene : s)) }));
    });
    await flush();
    expect(ai.calls).toHaveLength(0);
  });

  // #1318：場面編集は、その場面の声の速さで「表示時間に収める」を決める（速い声ならもう収まっている＝頼まない）。
  it("声が速ければ、尺に収まっているとして頼まない", async () => {
    const text = "あ".repeat(40); // 6 秒＝速さ 1.0 では 37 字まで・1.2 なら 45 字まで
    useProjectStore.setState((st) => ({
      scenes: [scene("scene_001", "短い。"), scene("scene_002", text, 6)],
      meta: { ...st.meta, voiceSettings: { ...st.meta.voiceSettings, speed: 1.2 } },
      editingSceneId: "scene_002", editingSceneAssist: ASSIST_KIND.fitDuration,
    }));
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    await flush();
    expect(ai.calls).toHaveLength(0);
    useProjectStore.setState((st) => ({ meta: { ...st.meta, voiceSettings: { ...st.meta.voiceSettings, speed: 1 } } }));
    cleanup();
    resetAiSuggestAvailabilityForTest();
    useProjectStore.setState({ editingSceneId: "scene_002", editingSceneAssist: ASSIST_KIND.fitDuration });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    await flush();
    expect(ai.calls).toHaveLength(1);
  });

  it("印が無ければ頼まない", async () => {
    useProjectStore.setState({ editingSceneId: "scene_002", editingSceneAssist: null });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    await flush();
    expect(ai.calls).toHaveLength(0);
  });

  it("同梱の AI が無ければ頼まない（セリフ欄へ寄るだけ）", async () => {
    ai.available = false;
    useProjectStore.setState({ editingSceneId: "scene_002", editingSceneFocus: "narration", editingSceneAssist: ASSIST_KIND.shorten });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    await flush();
    expect(ai.calls).toHaveLength(0);
  });
});

// UI/UX 監査 2026-10-02：字幕の長さも、セリフの長さと同じく AI に頼める（以前は場面を開くだけだった）。
describe("公開前チェックの「字幕の長さ」から字幕の手伝いへ", () => {
  const withSubtitle = (sceneId: string, subtitle: string, narration = "私たちは地域の配送を担っています。"): Scene =>
    ({ ...scene(sceneId, narration), texts: { subtitle } }) as Scene;
  const LONG = "う".repeat(MAX_SUBTITLE_LEN_DEFAULT + 5);

  it("「短くする」で該当場面の「文字」の節へ寄り、セリフから字幕を作るを頼む印を置く", () => {
    useProjectStore.setState({ scenes: [withSubtitle("scene_001", "短い"), withSubtitle("scene_002", LONG)], templates: sampleTemplates });
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "短くする" }));
    const st = useProjectStore.getState();
    expect(st.editingSceneId).toBe("scene_002");
    expect(st.editingSceneFocus).toBe("text");
    expect(st.editingSceneAssist).toBe(ASSIST_KIND.subtitle);
  });

  it("セリフが無い場面しか無ければ、寄るだけ（頼まない）", () => {
    useProjectStore.setState({ scenes: [withSubtitle("scene_001", LONG, "")], templates: sampleTemplates });
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "短くする" }));
    expect(useProjectStore.getState().editingSceneFocus).toBe("text");
    expect(useProjectStore.getState().editingSceneAssist).toBeNull();
  });

  it("場面編集は字幕の欄で1回だけ頼み（セリフの欄では頼まない）、印を消す", async () => {
    // 「文字」の節を閉じたことにしておく＝寄る指定で開くことまで見る（開いたままだと開く処理を通らなくても緑になる）。
    saveSectionOpen(SECTION_SCOPE.sceneEdit, "文字", false);
    useProjectStore.setState({
      scenes: [withSubtitle("scene_001", "短い"), withSubtitle("scene_002", LONG)], templates: sampleTemplates,
      editingSceneId: "scene_002", editingSceneFocus: "text", editingSceneAssist: ASSIST_KIND.subtitle,
    });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    await flush();
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]).toContain("字幕");
    expect(ai.calls[0]).not.toContain("短く言い直す");
    expect(useProjectStore.getState().editingSceneAssist).toBeNull();
    // 「文字」の節が開いている（字幕の候補がその場に出る）。⚠️ 閉じた節の中身も DOM にはある＝開いているかは details で見る。
    expect(screen.getByText("短くした候補です。").closest("details")?.open).toBe(true);
    expect(useProjectStore.getState().scenes[1].texts.subtitle).toBe(LONG); // 「使う」までは変えない
  });
});

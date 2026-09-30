// @vitest-environment jsdom
// 仕上がり確認の別窓（ADR-0050）＝別窓の側。操作は本体へ送るだけ・写しを受けて描く・保存も時計も音も持たない。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { MainToPreviewMessage, PreviewToMainMessage } from "../../infrastructure/previewWindow";

const toMain: PreviewToMainMessage[] = [];
let fromMain: ((m: MainToPreviewMessage) => void) | null = null;
const closeSelf = vi.fn(async () => {});
let rectHandler: ((r: { x: number; y: number; w: number; h: number }) => void) | null = null;
vi.mock("../../infrastructure/previewWindow", () => ({
  sendToMain: async (m: PreviewToMainMessage) => { toMain.push(m); },
  onMainMessage: async (h: (m: MainToPreviewMessage) => void) => { fromMain = h; return () => { if (fromMain === h) fromMain = null; }; },
  closeSelf: () => closeSelf(),
  onOwnRectChange: async (h: (r: { x: number; y: number; w: number; h: number }) => void) => { rectHandler = h; return () => {}; },
  isPreviewWindowContext: () => true,
  // 本体の側の入口（この窓では使わない）。
  openPreviewWindow: async () => false,
  closePreviewWindow: async () => {},
  onPreviewWindowClosed: () => () => {},
  onPreviewMessage: async () => () => {},
  sendToPreview: async () => {},
  readScreens: async () => ({ monitors: [], main: null }),
}));

import { PreviewWindowApp } from "./PreviewWindowApp";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";
import { setPanelLayout } from "../../infrastructure/appSettings";
import { PANEL_SCREEN } from "../../domain/layout/panelLayout";
import { PANEL_ID, timelineDefaultLayout } from "../timelinePanels";
import { EDIT_BLOCKED } from "../../domain/timeline/edit";

const doc: TimelineProject = {
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: "proj_20260929_001",
  projectName: "テスト",
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
  clips: [
    { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "あ" },
  ] as TimelineProject["clips"],
};

// ⚠️ この窓は store の操作を差し替える＝検査ごとに元へ戻す（次の検査へ持ち越さない）。
const original = useTimelineStore.getState();
const calls = () => toMain.filter((m): m is Extract<PreviewToMainMessage, { type: "call" }> => m.type === "call").map((m) => m.name);
let patchSeq = 0;
/** 本体からの写し（回の印は1つ・番号は通し・本体は別窓の命令をすべて実行し終えている）。 */
const patch = (values: Record<string, unknown>, cleared: string[] = [], opts: { ack?: number; seq?: number; session?: string } = {}) =>
  act(() => fromMain!({ type: "patch", values, cleared, session: opts.session ?? "s1", seq: opts.seq ?? ++patchSeq, ack: opts.ack ?? 1e9 }));

beforeEach(() => {
  toMain.length = 0;
  fromMain = null;
  patchSeq = 0;
  closeSelf.mockClear();
  localStorage.clear();
  useTimelineStore.setState(original, true);
  useTimelineStore.setState({ doc: null, isPlaying: false, playheadSec: 0, selectedClipIds: [] });
  useProjectStore.setState({ loadUserTemplates: vi.fn(async () => {}), refreshUserFonts: vi.fn(async () => {}) } as never);
});
afterEach(() => useTimelineStore.setState(original, true));

async function mount() {
  render(<PreviewWindowApp />);
  await act(async () => {});
  await act(async () => {});
}

describe("仕上がり確認の別窓（ADR-0050）＝別窓の側", () => {
  it("開くと本体に写しを頼み、届くまでは待っている旨を出す", async () => {
    await mount();
    expect(toMain).toContainEqual({ type: "ready" });
    expect(screen.getByRole("status").textContent).toBe("本体の窓から読み込んでいます…");
  });

  it("store の操作は本体へ送るだけ（手元では再生しない・保存もしない）", async () => {
    await mount();
    act(() => useTimelineStore.getState().play());
    expect(calls()).toContain("play");
    expect(useTimelineStore.getState().isPlaying).toBe(false);
    toMain.length = 0;
    act(() => { void useTimelineStore.getState().saveTimelineProject(); });
    expect(calls()).not.toContain("saveTimelineProject");
  });

  it("写しが届くと、仕上がり確認だけを描く（見出しの行・書き出し・並びは出さない）", async () => {
    await mount();
    patch({ doc });
    expect(screen.getByTestId("preview-window")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "動画を書き出す" })).toBeNull();
    expect(document.querySelector(".timeline-lane")).toBeNull();
    expect(screen.getByRole("button", { name: "再生" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "別の窓で見る" })).toBeNull();
  });

  it("「再生」は本体へ頼む（手元の再生の印は、本体の写しで変わる）", async () => {
    await mount();
    patch({ doc });
    fireEvent.click(screen.getByRole("button", { name: "再生" }));
    expect(calls()).toContain("play");
    expect(screen.getByRole("button", { name: "再生" })).toBeTruthy();
    patch({ isPlaying: true });
    expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
  });

  it("キー操作も同じ処理が走り、本体へ頼む（Ctrl+Z で取り消し）", async () => {
    await mount();
    patch({ doc });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(calls()).toContain("undo");
  });

  it("見え方の道具は窓の上端の行にある（絵の上に重ねない）", async () => {
    await mount();
    patch({ doc });
    const tools = screen.getByTestId("preview-view-tools");
    expect(tools.closest(".preview-window-bar")).not.toBeNull();
    expect(document.querySelector(".panel-frame-body")!.contains(tools)).toBe(false);
  });

  it("「この窓を閉じる」で自分を閉じる", async () => {
    await mount();
    patch({ doc });
    fireEvent.click(screen.getByRole("button", { name: "この窓を閉じる" }));
    expect(closeSelf).toHaveBeenCalled();
  });

  it("本体が動画を閉じたら、この窓も閉じる", async () => {
    await mount();
    patch({ doc });
    patch({ doc: null });
    await act(async () => {});
    expect(closeSelf).toHaveBeenCalled();
  });

  it("本体から「閉じて」が来たら閉じる", async () => {
    await mount();
    act(() => fromMain!({ type: "close" }));
    expect(closeSelf).toHaveBeenCalled();
  });

  it("再生中は描くたびに本体へ合図する（本体の窓が隠れても再生を進める）", async () => {
    await mount();
    patch({ doc, isPlaying: true });
    toMain.length = 0;
    await act(() => new Promise<void>((r) => setTimeout(r, 60)));
    expect(toMain.some((m) => m.type === "tick")).toBe(true);
    patch({ isPlaying: false });
    await act(() => new Promise<void>((r) => setTimeout(r, 20)));
    toMain.length = 0;
    await act(() => new Promise<void>((r) => setTimeout(r, 60)));
    expect(toMain.some((m) => m.type === "tick")).toBe(false);
  });

  // ⚠️ 中へ入った印は「入った時点の選択と同じ物」の間だけ出る＝写しで差し替えると印が消える。
  it("選ぶ操作は手元でも先に当て、同じ中身の写しが来ても手元の物を保つ", async () => {
    await mount();
    patch({ doc });
    act(() => useTimelineStore.getState().selectClip("clip_001"));
    const local = useTimelineStore.getState().selectedClipIds;
    expect(local).toEqual(["clip_001"]);
    expect(calls()).toContain("selectClip");
    patch({ selectedClipIds: ["clip_001"] });
    expect(useTimelineStore.getState().selectedClipIds).toBe(local);
  });

  // ⚠️ 手元で先に当てた選択を、選ぶ命令より前の写しで巻き戻さない（#1274 レビュー）。
  it("選んだ直後に届いた古い写しの選択は当てず、本体が選ぶ命令を実行した後の写しで揃う", async () => {
    await mount();
    patch({ doc, selectedClipIds: [] }, [], { ack: 0 });
    act(() => useTimelineStore.getState().selectClip("clip_001"));
    const sent = toMain.filter((m) => m.type === "call" && m.name === "selectClip").pop() as { seq: number };
    // 本体がまだ選ぶ命令を実行していない写し（本体の古い選択が載っている）。
    patch({ selectedClipIds: [], playheadSec: 1 }, [], { ack: sent.seq - 1 });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    expect(useTimelineStore.getState().playheadSec, "選択以外の項目まで捨てた").toBe(1);
    // 実行し終えた写し＝本体の選択に揃える。
    patch({ selectedClipIds: ["clip_001", "x"] }, [], { ack: sent.seq });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001", "x"]);
  });

  it("届く順が入れ替わった古い写しは捨てる・本体が開き直したら受ける", async () => {
    await mount();
    patch({ doc, playheadSec: 3 }, [], { seq: 10 });
    patch({ playheadSec: 1 }, [], { seq: 9 });
    expect(useTimelineStore.getState().playheadSec).toBe(3);
    patch({ playheadSec: 2 }, [], { seq: 1, session: "s2" });
    expect(useTimelineStore.getState().playheadSec).toBe(2);
  });

  it("隠れた・見えたを本体へ知らせる（両方の窓が隠れたら本体が再生を止めるため）", async () => {
    await mount();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(toMain.filter((m) => m.type === "visibility")).toEqual([{ type: "visibility", hidden: true }, { type: "visibility", hidden: false }]);
  });

  it("つながらないまま待たせ続けない（8秒で次の行動を出す）", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearTimeout", "clearInterval"] });
    try {
      render(<PreviewWindowApp />);
      await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
      expect(screen.getByRole("status").textContent).toBe("本体の窓から読み込んでいます…");
      await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
      expect(screen.getByRole("status").textContent).toBe("本体の窓とつながりませんでした。この窓を閉じて、本体の「別の窓で見る」から開き直してください");
      expect(toMain.filter((m) => m.type === "ready").length, "言い直しをやめた").toBeGreaterThan(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("位置を覚える待ちの間に閉じても、最後の位置は書く", async () => {
    const { unmount } = render(<PreviewWindowApp />);
    await act(async () => {});
    await act(async () => {});
    act(() => rectHandler!({ x: 10, y: 20, w: 800, h: 600 }));
    unmount();
    expect(JSON.parse(localStorage.getItem("timeline.previewWindow.rect") ?? "null")).toEqual({ x: 10, y: 20, w: 800, h: 600 });
  });

  // 音は本体だけ（ADR-0050 決定2）＝鳴らす設定の動画でも、別窓では音を消して映す（二重に鳴らさない）。
  it("鳴らす設定の動画でも、別窓では音を消して映す", async () => {
    await mount();
    patch({
      doc: {
        ...doc,
        assets: [{ assetId: "asset_v", assetType: "video", displayName: "紹介", filePath: "v.mp4", metadata: { hasAudio: true } }],
        clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 1920, h: 1080, assetId: "asset_v", useOriginalAudio: true, originalAudioVolume: 0.8 }],
      },
      assetSrcById: { asset_v: "blob:thumb_v" },
      videoSrcById: { asset_v: "blob:body_v" },
    });
    const v = document.querySelector(".preview-stage video") as HTMLVideoElement | null;
    expect(v).not.toBeNull();
    expect(v!.muted).toBe(true);
  });

  it("絵を止めて音だけ流す動画も、別窓では流さない", async () => {
    await mount();
    patch({
      doc: {
        ...doc,
        assets: [{ assetId: "asset_v", assetType: "video", displayName: "紹介", filePath: "v.mp4", metadata: { hasAudio: true } }],
        clips: [
          { id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 960, h: 540, assetId: "asset_v", useOriginalAudio: true, originalAudioVolume: 0.6 },
          { id: "clip_002", kind: TIMELINE_CLIP_KIND.shape, trackId: "track_001", startSec: 0, durationSec: 5, x: 960, y: 0, w: 960, h: 540 },
        ],
        groups: [{ id: "group_001", members: ["clip_001", "clip_002"], transform: { x: 0, y: 0, scale: 1, rotation: 0 } }],
        animations: [{ id: "anim_001", targetId: "group_001", keyframes: [{ timeSec: 0, opacity: 0.2 }, { timeSec: 5, opacity: 1 }] }],
      },
      assetSrcById: { asset_v: "blob:thumb_v" },
      videoSrcById: { asset_v: "blob:body_v" },
    });
    expect(document.querySelector(".preview-stage-wrap > video")).toBeNull();
  });

  // ⚠️ 本体の配置を読むと、本体で閉じた欄を「閉じている」と見なし、その場の返事を欄の外へ出してしまう。
  it("本体の配置を読まない（本体で仕上がり確認を閉じていても、返事は欄の中に出す）", async () => {
    const mainLayout = timelineDefaultLayout();
    mainLayout.nodes.center = null;
    setPanelLayout(PANEL_SCREEN.timeline, mainLayout);
    await mount();
    patch({ doc, editBlocked: { reason: EDIT_BLOCKED.locked, at: PANEL_ID.preview } });
    const notices = screen.getAllByRole("alert").filter((el) => el.textContent?.includes("この列は固定されています"));
    expect(notices).toHaveLength(1);
    expect(notices[0].closest(".panel-frame-body"), "欄の外に出た＝本体の配置を読んだ").not.toBeNull();
  });

  it("欄の配置を保存しない（本体の配置を上書きしない）", async () => {
    await mount();
    patch({ doc });
    await act(() => new Promise<void>((r) => setTimeout(r, 400)));
    expect(Object.keys(localStorage).filter((k) => k.includes("panel") || k.includes("layout"))).toEqual([]);
  });
});

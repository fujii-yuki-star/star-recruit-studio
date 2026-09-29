// @vitest-environment jsdom
// 仕上がり確認の別窓（ADR-0050）＝本体の側。開く・写しを送る・命令を受ける・閉じたら後始末。
// ⚠️ 窓の間の運び方（Tauri の窓とイベント）は差し替えて、本体が送った物・受けた物を直接見る。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { MainToPreviewMessage, PreviewToMainMessage } from "../../infrastructure/previewWindow";

const sent: MainToPreviewMessage[] = [];
let fromPreview: ((m: PreviewToMainMessage) => void) | null = null;
let closed: (() => void) | null = null;
const openWin = vi.fn(async (_title: string, _rect: unknown) => true);
const closeWin = vi.fn(async () => { closed?.(); });
vi.mock("../../infrastructure/previewWindow", () => ({
  openPreviewWindow: (title: string, rect: unknown) => openWin(title, rect),
  closePreviewWindow: () => closeWin(),
  onPreviewWindowClosed: (h: () => void) => { closed = h; return () => { if (closed === h) closed = null; }; },
  onPreviewMessage: async (h: (m: PreviewToMainMessage) => void) => { fromPreview = h; return () => { if (fromPreview === h) fromPreview = null; }; },
  sendToPreview: async (m: MainToPreviewMessage) => { sent.push(m); },
  readScreens: async () => ({ monitors: [{ x: 0, y: 0, w: 1920, h: 1040 }], main: { x: 0, y: 0, w: 1600, h: 900 } }),
  closeSelf: vi.fn(),
  isPreviewWindowContext: () => false,
}));

import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { setPlaybackPulse } from "../hooks/playbackPulse";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";

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

/** 描く1回ぶん待つ（写しは描く1回ぶんまとめて送る）。 */
const frame = () => act(() => new Promise<void>((r) => setTimeout(r, 40)));
const lastPatch = () => [...sent].reverse().find((m) => m.type === "patch") as Extract<MainToPreviewMessage, { type: "patch" }>;

beforeEach(() => {
  sent.length = 0;
  fromPreview = null;
  closed = null;
  openWin.mockClear();
  closeWin.mockClear();
  localStorage.clear();
  useTimelineStore.setState({ doc, loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], isPlaying: false, _historyGroupDepth: 0 });
});
afterEach(() => setPlaybackPulse(null));

async function openPopout() {
  render(<TimelineProjectScreen onNavigate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "別の窓で見る" }));
  await act(async () => {});
  await act(async () => {});
}

describe("仕上がり確認の別窓（ADR-0050）＝本体の側", () => {
  it("押すと別窓を開き（題は動画の名前）、押した印が付く。もう一度押すと閉じる", async () => {
    await openPopout();
    expect(openWin).toHaveBeenCalledTimes(1);
    expect(openWin.mock.calls[0][0]).toBe("仕上がり確認 — テスト");
    expect(openWin.mock.calls[0][1]).toMatchObject({ w: expect.any(Number), h: expect.any(Number) });
    const btn = screen.getByRole("button", { name: "別の窓で見る", pressed: true });
    fireEvent.click(btn);
    await act(async () => {});
    expect(closeWin).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "別の窓で見る", pressed: false })).toBeTruthy();
  });

  it("別窓が「写しをください」と言うと全部を送る（操作・取り消しの履歴・内部の段取りは送らない）", async () => {
    await openPopout();
    act(() => fromPreview!({ type: "ready" }));
    const p = lastPatch();
    expect(p.values.doc).toBe(doc);
    expect(p.values.selectedClipIds).toEqual([]);
    expect(Object.keys(p.values).some((k) => k.startsWith("_") || k === "history")).toBe(false);
    expect(Object.values(p.values).some((v) => typeof v === "function")).toBe(false);
  });

  it("本体が変わると、変わった項目だけを送る", async () => {
    await openPopout();
    act(() => fromPreview!({ type: "ready" }));
    sent.length = 0;
    act(() => useTimelineStore.getState().setPlayhead(1));
    await frame();
    expect(Object.keys(lastPatch().values).sort()).toEqual(["playheadSec", "seekNonce"].sort());
  });

  it("別窓の命令を本体の store で実行する（選ぶ・動かす）", async () => {
    await openPopout();
    act(() => fromPreview!({ type: "call", name: "selectClip", args: ["clip_001"], seq: 1 }));
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    act(() => fromPreview!({ type: "call", name: "setClipBoxFor", args: ["clip_001", { x: 40 }], seq: 2 }));
    expect((useTimelineStore.getState().doc!.clips[0] as { x: number }).x).toBe(40);
  });

  it("受けない命令（保存・書き出し）は実行しない", async () => {
    const save = vi.fn(async () => {});
    const exportVideo = vi.fn(async () => {});
    useTimelineStore.setState({ saveTimelineProject: save, exportTimelineVideo: exportVideo });
    await openPopout();
    save.mockClear();
    act(() => fromPreview!({ type: "call", name: "saveTimelineProject", args: [], seq: 3 }));
    act(() => fromPreview!({ type: "call", name: "exportTimelineVideo", args: [{}], seq: 4 }));
    expect(save).not.toHaveBeenCalled();
    expect(exportVideo).not.toHaveBeenCalled();
  });

  // ⚠️ 掴んだまま別窓を閉じると「まとまりを閉じる」が来ない＝以後の編集が1つの取り消しに飲み込まれる。
  it("別窓が始めた取り消しのまとまりは、別窓が閉じたら本体が閉じる", async () => {
    await openPopout();
    act(() => fromPreview!({ type: "call", name: "beginHistoryGroup", args: [], seq: 5 }));
    act(() => fromPreview!({ type: "call", name: "beginHistoryGroup", args: [], seq: 6 }));
    act(() => fromPreview!({ type: "call", name: "endHistoryGroup", args: [], seq: 7 }));
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(1);
    act(() => closed!());
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });

  // ⚠️ 閉じるのは**別窓が始めた分だけ**＝本体で掴んでいる最中のまとまりまで閉じない。
  it("別窓が閉じても、本体が自分で始めたまとまりは閉じない", async () => {
    await openPopout();
    act(() => fromPreview!({ type: "call", name: "beginHistoryGroup", args: [], seq: 8 }));
    act(() => fromPreview!({ type: "call", name: "endHistoryGroup", args: [], seq: 9 }));
    act(() => useTimelineStore.getState().beginHistoryGroup()); // 本体の操作
    act(() => closed!());
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(1);
  });

  it("別窓を読み込み直して「写しをください」が2度来ても、全部を送り直す", async () => {
    await openPopout();
    act(() => fromPreview!({ type: "ready" }));
    act(() => useTimelineStore.getState().setPlayhead(1));
    await frame();
    sent.length = 0;
    act(() => fromPreview!({ type: "ready" }));
    expect(lastPatch().values.doc).toBe(doc);
  });

  it("別窓の描く合図で、本体の時計を1歩進める", async () => {
    await openPopout();
    const pulse = vi.fn();
    setPlaybackPulse(pulse);
    act(() => fromPreview!({ type: "tick" }));
    expect(pulse).toHaveBeenCalledTimes(1);
  });

  it("本体が動画を閉じたら、別窓も閉じる", async () => {
    await openPopout();
    act(() => useTimelineStore.setState({ doc: null }));
    await act(async () => {});
    expect(closeWin).toHaveBeenCalled();
  });

  // 別窓は先に当てた選択を、本体が実行し終えた写しが来るまで守る＝写しに「どこまで実行したか」を添える（#1274 レビュー）。
  it("命令を実行したら、中身が変わらなくても「どこまで実行したか」を写しで返す", async () => {
    await openPopout();
    act(() => fromPreview!({ type: "ready" }));
    sent.length = 0;
    // 何も変えない命令（store に無い名前＝捨てる）でも、番号は返す＝別窓が先に当てた選択の待ちを解く。
    act(() => fromPreview!({ type: "call", name: "noSuchAction", args: [], seq: 7 }));
    await frame();
    expect(lastPatch()).toMatchObject({ ack: 7, values: {} });
    const s1 = lastPatch().seq;
    act(() => fromPreview!({ type: "call", name: "selectClip", args: ["clip_001"], seq: 8 }));
    await frame();
    expect(lastPatch()).toMatchObject({ ack: 8, values: { selectedClipIds: ["clip_001"] } });
    expect(lastPatch().seq, "通し番号が進まない").toBeGreaterThan(s1);
  });

  it("別窓を読み込み直したら、別窓が始めたまとまりを閉じる", async () => {
    await openPopout();
    act(() => fromPreview!({ type: "call", name: "beginHistoryGroup", args: [], seq: 1 }));
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(1);
    act(() => fromPreview!({ type: "ready" }));
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
  });

  it("別窓を開けなかったら、次の行動を出す（押しても何も起きない、を作らない）", async () => {
    openWin.mockImplementationOnce(async () => false);
    await openPopout();
    expect(screen.getByText("別の窓を開けませんでした。もう一度押すか、「大きく見る」で今の窓の中で大きくしてください")).toBeTruthy();
    expect(screen.getByRole("button", { name: "別の窓で見る", pressed: false })).toBeTruthy();
  });

  // 両方の窓が隠れると時計の合図が来ない＝時計は止まるのに音だけ進む（#1274 レビュー）。
  it("本体も別窓も隠れたら、再生を止める（どちらかが見えていれば止めない）", async () => {
    const pause = vi.fn();
    useTimelineStore.setState({ pause, isPlaying: true });
    await openPopout();
    const mainHidden = (h: boolean) =>
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    // 別窓が隠れても、本体が見えていれば止めない。
    mainHidden(false);
    act(() => fromPreview!({ type: "visibility", hidden: true }));
    expect(pause).not.toHaveBeenCalled();
    // 本体も隠れた＝止める。
    mainHidden(true);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(pause).toHaveBeenCalledTimes(1);
    // 別窓が見えている間に本体が隠れても止めない。
    pause.mockClear();
    act(() => fromPreview!({ type: "visibility", hidden: false }));
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(pause).not.toHaveBeenCalled();
    // 本体が隠れたまま、別窓も隠れた＝止める。
    act(() => fromPreview!({ type: "visibility", hidden: true }));
    expect(pause).toHaveBeenCalledTimes(1);
    mainHidden(false);
  });

  // 別窓で見ている間に本体を最小化しても、再生は止めない（時計は別窓の合図で進む）。
  it("別窓を開いている間は、本体が隠れても再生を止めない（開く前は止める）", async () => {
    const pause = vi.fn();
    useTimelineStore.setState({ pause });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const hide = () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    };
    hide();
    expect(pause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "別の窓で見る" }));
    await act(async () => {});
    await act(async () => {});
    hide();
    expect(pause).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });
});

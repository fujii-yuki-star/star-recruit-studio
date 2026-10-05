// @vitest-environment jsdom
// 動きの道筋と点（ADR-0054 段階2）＝選んだ部品の通り道を線で、位置のキーを点で描き、点を引くと**その時刻の位置だけ**直る。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { ANIMATED_DRAG_NOTE, MOTION_PATH_NOTE } from "../uiLabels";
import { isPointerDragging } from "../hooks/usePointerDrag";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { ClipAnimation, TimelineProject } from "../../domain/timeline/types";

const doc = (over: Partial<TimelineProject> = {}): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: "proj_20261005_001",
  projectName: "テスト",
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
  // 箱の中心は (50, 25)。
  clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
  animations: [{ id: "anim_001", targetId: "clip_001", keyframes: [{ timeSec: 0, x: 0, y: 0 }, { timeSec: 2, x: 960 }, { timeSec: 4, x: 1600, y: 400 }] }],
  ...over,
} as unknown as TimelineProject);

const open = (over: Partial<TimelineProject> = {}, playheadSec = 0) => {
  useProjectStore.setState({ templates: [] });
  useTimelineStore.setState({
    doc: doc(over), loadError: null, isLoading: false, playheadSec, isPlaying: false,
    selectedClipIds: ["clip_001"], assetSrcById: {}, videoSrcById: {}, editBlocked: null,
    history: { past: [], future: [] },
  } as never);
  return render(<TimelineProjectScreen onNavigate={vi.fn()} />);
};

const keys = () => screen.queryAllByTestId("motion-key");
const anim = (): ClipAnimation => useTimelineStore.getState().doc!.animations![0];

/** 画面の 1px＝キャンバスの 2px（1920 幅を 960 で出している）。 */
const sizeOverlay = () => {
  const root = screen.getByTestId("motion-path");
  root.getBoundingClientRect = () => ({ left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
};

beforeEach(() => localStorage.clear());

describe("動きの道筋と点（ADR-0054 段階2）", () => {
  it("位置のキーごとに点を、通り道を線で描く（点は中心＝素の箱の中心に動きのずれを足した所）", () => {
    open();
    expect(screen.getByTestId("motion-path")).toBeInTheDocument();
    const ks = keys();
    expect(ks.map((k) => k.dataset.time)).toEqual(["0", "2", "4"]);
    expect(ks[1].style.left).toBe(`${((50 + 960) / 1920) * 100}%`);
    // 2 秒のキーは y を持たない＝その時刻に描かれている y（0 と 400 の中間＝200）
    expect(ks[1].style.top).toBe(`${((25 + 200) / 1080) * 100}%`);
    expect(document.querySelector(".motion-path-line")!.getAttribute("points")!.split(" ").length).toBeGreaterThan(60);
    expect(screen.getByText(MOTION_PATH_NOTE)).toBeInTheDocument();
  });

  it("いまの時刻ちょうどの点を強く出す", () => {
    open({}, 2);
    expect(keys().map((k) => k.classList.contains("motion-path-key--current"))).toEqual([false, true, false]);
  });

  it("点を引くと、その時刻の位置だけ直る（時刻もほかのキーも変えない・部品の箱も動かさない）", () => {
    open();
    sizeOverlay();
    const k = keys()[0];
    fireEvent.pointerDown(k, { button: 0, pointerId: 7, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(k, { pointerId: 7, clientX: 110, clientY: 95 });
    fireEvent.pointerMove(k, { pointerId: 7, clientX: 120, clientY: 90 }); // 合計 (+20, −10) 画面 px ＝ (+40, −20)
    fireEvent.pointerUp(k, { pointerId: 7 });
    expect(anim().keyframes).toEqual([{ timeSec: 0, x: 40, y: -20 }, { timeSec: 2, x: 960 }, { timeSec: 4, x: 1600, y: 400 }]);
    const c = useTimelineStore.getState().doc!.clips[0];
    expect([c.x, c.y]).toEqual([0, 0]);
  });

  it("持っていない軸は、横へ引いただけなら書き足さない", () => {
    open();
    sizeOverlay();
    const k = keys()[1]; // 2 秒＝x だけ
    fireEvent.pointerDown(k, { button: 0, pointerId: 7, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(k, { pointerId: 7, clientX: 30, clientY: 0 });
    fireEvent.pointerUp(k, { pointerId: 7 });
    expect(anim().keyframes[1]).toEqual({ timeSec: 2, x: 1020 });
  });

  it("1回の引き＝1回の取り消し", () => {
    open();
    sizeOverlay();
    const k = keys()[2];
    fireEvent.pointerDown(k, { button: 0, pointerId: 7, clientX: 0, clientY: 0 });
    for (let i = 1; i <= 5; i += 1) fireEvent.pointerMove(k, { pointerId: 7, clientX: i * 10, clientY: 0 });
    fireEvent.pointerUp(k, { pointerId: 7 });
    expect(anim().keyframes[2].x).toBe(1700);
    act(() => useTimelineStore.getState().undo());
    expect(anim().keyframes[2].x).toBe(1600);
  });

  it("点を掴んでも部品は選び直さず、本体を掴んだことにもならない", () => {
    open();
    sizeOverlay();
    const k = keys()[0];
    fireEvent.pointerDown(k, { button: 0, pointerId: 7, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(k, { pointerId: 7 });
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]);
    expect(useTimelineStore.getState().doc!.clips[0].x).toBe(0);
  });

  it("列が固定なら線は見せるが、点は動かない", () => {
    open({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] });
    sizeOverlay();
    const k = keys()[0];
    expect(k).toHaveClass("motion-path-key--disabled");
    expect(k.getAttribute("title")).toContain("固定を外す");
    fireEvent.pointerDown(k, { button: 0, pointerId: 7, clientX: 0, clientY: 0 });
    // 掴んだことにもしない（取り消しのまとまりを開かない・掴んでいる数に入れない）＝押した時点で見る。
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
    expect(isPointerDragging()).toBe(false);
    fireEvent.pointerMove(k, { pointerId: 7, clientX: 50, clientY: 0 });
    fireEvent.pointerUp(k, { pointerId: 7 });
    expect(anim().keyframes[0].x).toBe(0);
  });

  it("掴んでいる間は掴んでいる数に入る（その間 Ctrl+Z を通さない）・離せば外れる", () => {
    open();
    sizeOverlay();
    const k = keys()[0];
    fireEvent.pointerDown(k, { button: 0, pointerId: 7, clientX: 0, clientY: 0 });
    expect(isPointerDragging()).toBe(true);
    fireEvent.pointerUp(k, { pointerId: 7 });
    expect(isPointerDragging()).toBe(false);
  });

  it("別の指を離しても終わらない（掴んだ指だけ見る）", () => {
    open();
    sizeOverlay();
    const k = keys()[0];
    fireEvent.pointerDown(k, { button: 0, pointerId: 7, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(k, { pointerId: 8 });
    expect(isPointerDragging()).toBe(true);
    fireEvent.pointerUp(k, { pointerId: 7 });
    expect(isPointerDragging()).toBe(false);
  });

  it("Escape でやめると、掴む前の値へ戻る（書き足した軸も外す）・まとまりも締まる", () => {
    open();
    sizeOverlay();
    const k = keys()[1]; // 2 秒＝x だけ
    fireEvent.pointerDown(k, { button: 0, pointerId: 7, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(k, { pointerId: 7, clientX: 30, clientY: 30 });
    expect(anim().keyframes[1]).toEqual({ timeSec: 2, x: 1020, y: 260 });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(anim().keyframes[1]).toEqual({ timeSec: 2, x: 960 });
    expect(isPointerDragging()).toBe(false);
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
    expect(useTimelineStore.getState().selectedClipIds).toEqual(["clip_001"]); // 外側の Escape（選びを外す）まで走らない
  });

  it("指の取り上げ（pointercancel）でも元へ戻す", () => {
    open();
    sizeOverlay();
    const k = keys()[0];
    fireEvent.pointerDown(k, { button: 0, pointerId: 7, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(k, { pointerId: 7, clientX: 30, clientY: 0 });
    fireEvent.pointerCancel(k, { pointerId: 7 });
    expect(anim().keyframes[0]).toEqual({ timeSec: 0, x: 0, y: 0 });
  });

  it("位置を動かさない動き（拡縮だけ）なら描かず、一言は段階1のまま", () => {
    open({ animations: [{ id: "anim_001", targetId: "clip_001", keyframes: [{ timeSec: 0, scale: 1 }, { timeSec: 4, scale: 2 }] }] } as Partial<TimelineProject>);
    expect(screen.queryByTestId("motion-path")).toBeNull();
    expect(screen.getByText(ANIMATED_DRAG_NOTE)).toBeInTheDocument();
  });

  it("選びを外したら描かない", () => {
    open();
    act(() => useTimelineStore.setState({ selectedClipIds: [] }));
    expect(screen.queryByTestId("motion-path")).toBeNull();
  });

  // ⚠️ 掴んだまま点が消えたら（選び直した・再生を始めた）、取り消しのまとまりを締める＝以後の編集が1つに束ねられない。
  it("掴んだまま点が消えても、取り消しのまとまりは締まる", () => {
    open();
    sizeOverlay();
    const k = keys()[0];
    fireEvent.pointerDown(k, { button: 0, pointerId: 7, clientX: 0, clientY: 0 });
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(1);
    act(() => useTimelineStore.setState({ isPlaying: true })); // 再生を始めた＝点が消える（選びは変わらない）
    expect(screen.queryByTestId("motion-path")).toBeNull();
    expect(useTimelineStore.getState()._historyGroupDepth).toBe(0);
    expect(isPointerDragging()).toBe(false);
  });

  it("グループの変形の下では描かない（点の 1px が画面の 1px にならない＝段階1と同じ線引き）", () => {
    open({ groups: [{ id: "group_001", members: ["clip_001"], transform: { x: 0, y: 0, scale: 2, rotation: 0 } }] } as Partial<TimelineProject>);
    expect(screen.queryByTestId("motion-path")).toBeNull();
  });
});

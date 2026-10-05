// @vitest-environment jsdom
// UI/UX 監査 2026-10-02 PR4a（タイムライン）＝作業範囲を描く・消す前に確認する・キーで断る理由をボタンとそろえる・
// マウスで押した直後のボタンへ `Space` を譲らない・写す／貼るをメニューに出す。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { useExportLockStore } from "../store/exportLock";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { EDIT_BLOCKED } from "../../domain/timeline/edit";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";
import { editBlockedMessage } from "../uiLabels";
import { TimelineProjectScreen } from "./TimelineProjectScreen";

const doc = (): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: "proj_20260728_001",
  projectName: "範囲の検査",
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.visual }],
  clips: [
    { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "前" },
    { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 6, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "後" },
  ],
});

const open = (over: Record<string, unknown> = {}) =>
  useTimelineStore.setState({ doc: doc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {}, rangeInSec: null, rangeOutSec: null, isPlaying: false, clipClipboard: null, ...over } as never);

/** 範囲を消す確認の窓（ほかの知らせと見分ける）。 */
const rangeConfirm = (): HTMLElement => screen.getAllByRole("alert").find((a) => a.textContent?.includes("作業範囲（"))!;
const blockedReason = () => useTimelineStore.getState().editBlocked?.reason;

beforeEach(() => {
  vi.restoreAllMocks();
  useExportLockStore.setState({ owner: null });
  useTimelineStore.setState({ exportRun: { phase: "idle", percent: 0, message: null, cancelling: false } } as never);
  useTimelineStore.setState({ _voiceRun: null, generatingVoiceClipId: null } as never);
  useTimelineStore.getState().closeTimelineProject();
  useProjectStore.setState({ templates: [] });
  localStorage.clear();
});

describe("作業範囲を並びの上に描く（以前はどこにも描かれていなかった）", () => {
  it("両端を取ると網掛けと時刻が出る", () => {
    open({ rangeInSec: 2, rangeOutSec: 4 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const band = screen.getByTestId("timeline-range");
    expect(band.className).toBe("timeline-range");
    expect(parseFloat(band.style.width)).toBeGreaterThan(0);
    expect(screen.getByTestId("timeline-range-label").textContent).toContain("〜");
  });

  it("逆に取っても（ここまでが先）同じ幅で描く", () => {
    open({ rangeInSec: 4, rangeOutSec: 2 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(parseFloat(screen.getByTestId("timeline-range").style.width)).toBeGreaterThan(0);
  });

  it("片方だけのときは端の線だけ（幅の無い網掛けを広げない）", () => {
    open({ rangeInSec: 2 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByTestId("timeline-range").className).toContain("timeline-range--edge");
    expect(screen.queryByTestId("timeline-range-label")).toBeNull();
  });

  it("取っていなければ描かない", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByTestId("timeline-range")).toBeNull();
  });
});

describe("作業範囲を消す前に確認する（以前は確認なしで全部の列を切って詰めていた）", () => {
  it("「範囲を削除して詰める」は確認を出し、やめれば何も変わらない・進めば消して詰める", () => {
    open({ rangeInSec: 1, rangeOutSec: 7 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "範囲を削除して詰める" }));
    expect(useTimelineStore.getState().doc!.clips.map((c) => [c.id, c.startSec, c.durationSec])).toEqual([["clip_001", 0, 5], ["clip_002", 6, 4]]);
    const alert = rangeConfirm();
    expect(alert.textContent).toContain("2個の部品にかかります");
    expect(alert.textContent).toContain("すべての列");
    fireEvent.click(screen.getByText("やめる"));
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "範囲を削除して詰める" }));
    fireEvent.click(screen.getByText("削除する"));
    // 1〜7 を消して詰める＝前は 0〜1 が残り、後ろは 7〜10 が 1〜4 へ寄る。
    expect(useTimelineStore.getState().doc!.clips.map((c) => [c.startSec, c.durationSec])).toEqual([[0, 1], [1, 3]]);
  });

  it("「範囲を削除」（詰めない）も確認を出す", () => {
    open({ rangeInSec: 1, rangeOutSec: 3 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "範囲を削除" }));
    expect(rangeConfirm().textContent).toContain("1個の部品にかかります");
    expect(useTimelineStore.getState().doc!.clips[0].durationSec).toBe(5);
  });

  it("キー（Shift+Delete）でも同じ確認を通す（キーだけ確認なしで消える、を作らない）", () => {
    open({ rangeInSec: 1, rangeOutSec: 7 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "Delete", shiftKey: true });
    expect(useTimelineStore.getState().doc!.clips[0].durationSec).toBe(5);
    expect(rangeConfirm().textContent).toContain("2個の部品にかかります");
  });
});

describe("キーで断る理由はボタンと同じ（以前は何でも「その部品は見つかりませんでした」）", () => {
  it("範囲を取っていないのに Shift+Delete", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "Delete", shiftKey: true });
    expect(blockedReason()).toBe(EDIT_BLOCKED.rangeNotSet);
    expect(screen.getByRole("button", { name: "範囲を削除して詰める" }).getAttribute("title")).toBe(editBlockedMessage[EDIT_BLOCKED.rangeNotSet]);
  });

  it("幅の無い範囲で Shift+Delete", () => {
    open({ rangeInSec: 2, rangeOutSec: 2 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "Delete", shiftKey: true });
    expect(blockedReason()).toBe(EDIT_BLOCKED.rangeEmpty);
  });

  it("何も選ばずに Ctrl+K", () => {
    open({ playheadSec: 2 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(blockedReason()).toBe(EDIT_BLOCKED.splitNoneSelected);
  });

  it("2つ選んで Ctrl+K", () => {
    open({ playheadSec: 2, selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(blockedReason()).toBe(EDIT_BLOCKED.singleClipOnly);
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(2);
  });
});

describe("マウスで押した直後のボタンに `Space` を譲らない（型では Space は再生と停止だけ）", () => {
  it("「複製」をマウスで押したあとの Space は再生になり、もう1つ複製しない", () => {
    open({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const dup = screen.getAllByRole("button", { name: "複製" })[0];
    fireEvent.pointerDown(dup);
    dup.focus();
    fireEvent.click(dup);
    const after = useTimelineStore.getState().doc!.clips.length;
    const ev = fireEvent.keyDown(dup, { key: " " });
    expect(ev, "既定（ボタンを押す）を止めていない").toBe(false);
    expect(useTimelineStore.getState().isPlaying).toBe(true);
    expect(useTimelineStore.getState().doc!.clips.length).toBe(after);
    act(() => useTimelineStore.getState().pause());
  });

  it("キーボードで焦点を移したボタンは、これまでどおり Space で押せる", () => {
    open({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const buttons = screen.getAllByRole("button", { name: "複製" });
    // マウスで押したあと、別の所へ焦点が移り（Tab）、また戻ってきた＝キーボードでたどり着いた。
    fireEvent.pointerDown(buttons[0]);
    buttons[0].focus();
    const elsewhere = screen.getByRole("slider", { name: "時間の目盛り" });
    elsewhere.focus();
    buttons[0].focus();
    const ev = fireEvent.keyDown(buttons[0], { key: " " });
    expect(ev, "キーボードで来たボタンの Space を奪っている").toBe(true);
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });
});

describe("写す／貼るをメニューに出す（以前はキーでしか届かなかった）", () => {
  it("帯の右クリックに「写す」「再生位置に貼る」がある・写す前は貼れない理由を出す", () => {
    open({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getAllByRole("button", { name: /前/ }).find((b) => b.classList.contains("timeline-clip"))!);
    const paste = screen.getByRole("menuitem", { name: /再生位置に貼る/ });
    expect(paste).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: /写す/ }));
    expect(useTimelineStore.getState().clipClipboard?.map((c) => c.id)).toEqual(["clip_001"]);
  });

  it("写したあとは「再生位置に貼る」で貼れる（キーと同じ入口）", () => {
    open({ selectedClipIds: ["clip_001"], playheadSec: 20 });
    act(() => useTimelineStore.getState().copySelectedClips());
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getAllByRole("button", { name: /前/ }).find((b) => b.classList.contains("timeline-clip"))!);
    fireEvent.click(screen.getByRole("menuitem", { name: /再生位置に貼る/ }));
    expect(useTimelineStore.getState().doc!.clips).toHaveLength(3);
  });
});

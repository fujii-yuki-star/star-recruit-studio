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
import { resetSpaceFocusForTest } from "../hooks/spaceFocus";
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
  resetSpaceFocusForTest();
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

  it("逆に取っても（ここまでが先）同じ位置・同じ幅・同じ時刻で描く", () => {
    open({ rangeInSec: 2, rangeOutSec: 4 });
    const a = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const fwd = { left: screen.getByTestId("timeline-range").style.left, width: screen.getByTestId("timeline-range").style.width, label: screen.getByTestId("timeline-range-label").textContent };
    a.unmount();
    open({ rangeInSec: 4, rangeOutSec: 2 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByTestId("timeline-range").style.left).toBe(fwd.left);
    expect(screen.getByTestId("timeline-range").style.width).toBe(fwd.width);
    expect(screen.getByTestId("timeline-range-label").textContent).toBe(fwd.label);
    // 始まりは早いほう（2秒）＝左端は 2 秒の位置。
    const px = Number(/\+ (\d+(?:\.\d+)?)px\)$/.exec(fwd.left)![1]);
    // 2〜4秒＝始まり（2秒）の位置と幅（2秒ぶん）が同じ px になる＝始まりを遅いほう（4秒）にすると倍になる。
    expect(px).toBeCloseTo(parseFloat(fwd.width));
    expect(fwd.label).toBe("作業範囲：0:02.00〜0:04.00");
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

  it("「範囲を削除」（詰めない）も確認を出す・詰めるとは言わないが、すべての列が対象とは言う", () => {
    open({ rangeInSec: 1, rangeOutSec: 3 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "範囲を削除" }));
    expect(rangeConfirm().textContent).toContain("1個の部品にかかります");
    // 詰めないときも列を選ばずに消す＝すべての列が対象（PR4a レビュー ℹ️）。
    expect(rangeConfirm().textContent).toContain("すべての列");
    expect(rangeConfirm().textContent).not.toContain("詰め");
    expect(useTimelineStore.getState().doc!.clips[0].durationSec).toBe(5);
  });

  it("部品の掛からない範囲を詰めるときは「空白を詰めますか」と言う", () => {
    open({ rangeInSec: 5.2, rangeOutSec: 5.8 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "範囲を削除して詰める" }));
    expect(rangeConfirm().textContent).toContain("空白を詰めますか");
  });

  it("部品の掛からない範囲を詰めずに消すボタンは、押す前に理由を出す", () => {
    open({ rangeInSec: 5.2, rangeOutSec: 5.8 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const b = screen.getByRole("button", { name: "範囲を削除" });
    expect(b).toBeDisabled();
    expect(b.getAttribute("title")).toBe(editBlockedMessage[EDIT_BLOCKED.rangeNoClips]);
  });

  it("確認を出している間に再生が始まったら、押しても消さずに理由を出す", () => {
    open({ rangeInSec: 1, rangeOutSec: 7 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "範囲を削除して詰める" }));
    act(() => useTimelineStore.setState({ isPlaying: true }));
    fireEvent.click(screen.getByText("削除する"));
    expect(useTimelineStore.getState().doc!.clips[0].durationSec).toBe(5);
    expect(blockedReason()).toBe(EDIT_BLOCKED.playing);
    act(() => useTimelineStore.getState().pause());
  });

  it("確認を出している間に書き出しが始まったら、押しても消さない", () => {
    open({ rangeInSec: 1, rangeOutSec: 7 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "範囲を削除して詰める" }));
    act(() => useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } } as never));
    fireEvent.click(screen.getByText("削除する"));
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

describe("範囲を消す関門（PR4a レビュー）", () => {
  it("書き出し中の Shift+Delete は確認を開かず、理由を出す（黙って何もしない、を作らない）", () => {
    open({ rangeInSec: 1, rangeOutSec: 7 });
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } } as never);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.keyDown(window, { key: "Delete", shiftKey: true });
    expect(screen.queryAllByRole("alert").some((x) => x.textContent?.includes("作業範囲（")), "書き出し中に確認を開いた").toBe(false);
    expect(blockedReason()).toBe(EDIT_BLOCKED.exporting);
  });

  it("固定した列の部品を選んでいても、範囲のボタンは選択ではなく範囲で断る（固定した列が範囲の対象なら、その理由）", () => {
    const d = doc();
    d.tracks[0] = { ...d.tracks[0], locked: true };
    useTimelineStore.setState({ doc: d, loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: ["clip_001"], assetSrcById: {}, rangeInSec: 1, rangeOutSec: 7, isPlaying: false, clipClipboard: null } as never);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "範囲を削除" }).getAttribute("title")).toBe(editBlockedMessage[EDIT_BLOCKED.lockedSelection]);
    expect(screen.getByRole("button", { name: "範囲を削除して詰める" }).getAttribute("title")).toBe(editBlockedMessage[EDIT_BLOCKED.lockedSelection]);
  });

  it("確認を出している間に範囲が消えたら確認も閉じ、取り直しても勝手に出てこない", () => {
    open({ rangeInSec: 1, rangeOutSec: 7 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "範囲を削除して詰める" }));
    act(() => useTimelineStore.getState().clearRange());
    act(() => useTimelineStore.setState({ rangeInSec: 1, rangeOutSec: 7 }));
    expect(screen.queryAllByRole("alert").some((x) => x.textContent?.includes("作業範囲（"))).toBe(false);
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

  it("ボタンの中の文字やアイコンを押しても、そのボタンを覚える", () => {
    open({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const dup = screen.getAllByRole("button", { name: "複製" })[0];
    const inner = document.createElement("span");
    dup.appendChild(inner);
    fireEvent.pointerDown(inner);
    dup.focus();
    expect(fireEvent.keyDown(dup, { key: " " })).toBe(false);
    act(() => useTimelineStore.getState().pause());
  });

  it("マウスで押したあと、キー（Tab）で別のボタンへ移ったら、そちらへ Space を譲る", () => {
    open({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const [a] = screen.getAllByRole("button", { name: "複製" });
    const b = screen.getByRole("button", { name: "ここから（範囲）" });
    fireEvent.pointerDown(a);
    a.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    b.focus();
    expect(fireEvent.keyDown(b, { key: " " })).toBe(true);
  });

  it("選ぶ欄（select）はマウスで触っても譲る（そこでの Space は選ぶ操作）", () => {
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const sel = container.querySelector("select");
    if (!sel) return; // 画面に選ぶ欄が無い形なら対象外（spaceFocus の単体の検査で見る）
    fireEvent.pointerDown(sel);
    sel.focus();
    expect(fireEvent.keyDown(sel, { key: " " })).toBe(true);
  });

  it("キーボードで焦点を移したボタンは、これまでどおり Space で押せる", () => {
    open({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const [a] = screen.getAllByRole("button", { name: "複製" });
    fireEvent.pointerDown(a);
    a.focus();
    // Tab で離れて、Tab で戻ってきた＝キーボードでたどり着いた。
    fireEvent.keyDown(window, { key: "Tab" });
    screen.getByRole("slider", { name: "時間の目盛り" }).focus();
    fireEvent.keyDown(window, { key: "Tab" });
    a.focus();
    expect(fireEvent.keyDown(a, { key: " " }), "キーボードで来たボタンの Space を奪っている").toBe(true);
    expect(useTimelineStore.getState().isPlaying).toBe(false);
  });

  it("Tab で来たボタンをマウスで押し直したら、それはマウスで押したボタン（再生になる）", () => {
    open({ selectedClipIds: ["clip_001"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const [a] = screen.getAllByRole("button", { name: "複製" });
    fireEvent.keyDown(window, { key: "Tab" });
    a.focus();
    fireEvent.pointerDown(a); // 焦点は動かない（既にある）
    expect(fireEvent.keyDown(a, { key: " " })).toBe(false);
    act(() => useTimelineStore.getState().pause());
  });

  it("確認をマウスで閉じて焦点が開いたボタンへ戻っても、Space は再生（確認を開き直さない）", () => {
    open({ rangeInSec: 1, rangeOutSec: 7 });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const opener = screen.getByRole("button", { name: "範囲を削除して詰める" });
    fireEvent.pointerDown(opener);
    opener.focus();
    fireEvent.click(opener);
    const cancel = screen.getByText("やめる");
    fireEvent.pointerDown(cancel);
    fireEvent.click(cancel);
    expect(document.activeElement, "焦点が開いたボタンへ戻っていない（前提が崩れた）").toBe(opener);
    expect(fireEvent.keyDown(opener, { key: " " }), "閉じたあとの Space で確認を開き直す").toBe(false);
    act(() => useTimelineStore.getState().pause());
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

  it("2つ選んでいれば「選んだ2個を写す」・キーの表示も添える", () => {
    open({ selectedClipIds: ["clip_001", "clip_002"] });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getAllByRole("button", { name: /前/ }).find((b) => b.classList.contains("timeline-clip"))!);
    const copy = screen.getByRole("menuitem", { name: /選んだ2個を写す/ });
    expect(copy.textContent).toContain("Ctrl+C");
    expect(screen.getByRole("menuitem", { name: /再生位置に貼る/ }).textContent).toContain("Ctrl+V");
  });

  it("書き出し中は、写していても貼れない（理由つき）", () => {
    open({ selectedClipIds: ["clip_001"], playheadSec: 20 });
    act(() => useTimelineStore.getState().copySelectedClips());
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 10, message: null, cancelling: false } } as never);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getAllByRole("button", { name: /前/ }).find((b) => b.classList.contains("timeline-clip"))!);
    expect(screen.getByRole("menuitem", { name: /再生位置に貼る/ })).toBeDisabled();
  });

  it("固定した列の帯を右クリックしても、貼る（貼る先は写した部品の元の列）は塞がない＝Ctrl+V と同じ条件", () => {
    const d = doc();
    d.tracks[0] = { ...d.tracks[0], locked: true };
    useTimelineStore.setState({ doc: d, loadError: null, isLoading: false, playheadSec: 20, selectedClipIds: ["clip_002"], assetSrcById: {}, rangeInSec: null, rangeOutSec: null, isPlaying: false, clipClipboard: null } as never);
    act(() => useTimelineStore.getState().copySelectedClips());
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.contextMenu(screen.getAllByRole("button", { name: /前/ }).find((x) => x.classList.contains("timeline-clip"))!);
    expect(screen.getByRole("menuitem", { name: /再生位置に貼る/ })).not.toBeDisabled();
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

// @vitest-environment jsdom
// #948：帯を押しても**焦点を帯へ移さない**（＝そのあと `Space` で再生・停止できる）。
//
// ⚠️ **帯は `<button>`**なので、押すと焦点がそこへ移り、以後 `Space` は**ボタンの起動**に使われて
// 再生・停止に届かない。焦点が移るかは `pointerdown` の `preventDefault` 次第で、以前は
// `usePointerDrag`（掴む処理）に入ったときだけ通っていた＝`grabbableClip`
//（`!exporting && !isPlaying && !locked`）が偽の帯、つまり**再生中と固定した列でだけ壊れて**いた。
//
// ⚠️ **合成のクリックでは再現しない**＝`element.click()` は既定動作（焦点の移動）を起こさない。
// 実アプリでも「クリックを模す」だけでは気づけなかったので、ここでは**`pointerdown` の
// `defaultPrevented` そのもの**を見る（焦点が移らないことの直接の条件）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { useExportLockStore } from "../store/exportLock";
import { DUPLICATE_LABEL } from "../uiLabels";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";

const doc = (over: Partial<TimelineProject> = {}): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: "proj_20260728_001",
  projectName: "焼いた動画",
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
  clips: [
    { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "こんにちは" },
  ],
  ...over,
});

/** 帯（`<button class="timeline-clip">`）へ `pointerdown` を送り、既定が止まったかを返す。 */
function pressClip(): { found: boolean; prevented: boolean } {
  const clip = document.querySelector(".timeline-clip");
  if (!clip) return { found: false, prevented: false };
  const e = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, buttons: 1 });
  clip.dispatchEvent(e);
  return { found: true, prevented: e.defaultPrevented };
}

describe("帯を押しても焦点を帯へ移さない（#948）", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useExportLockStore.setState({ owner: null });
    useTimelineStore.setState({ exportRun: { phase: "idle", percent: 0, message: null, cancelling: false } });
    useTimelineStore.getState().closeTimelineProject();
    useProjectStore.setState({ templates: [] });
  });

  it("ふつうの帯（掴める）", () => {
    useTimelineStore.setState({ doc: doc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {} });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(pressClip()).toEqual({ found: true, prevented: true });
  });

  // ⚠️ **ここが壊れていた側**＝固定した列の帯は掴めないので、以前は `preventDefault` に届かなかった。
  it("固定した列の帯（掴めない）", () => {
    useTimelineStore.setState({
      doc: doc({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] }),
      loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {},
    });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // ⚠️ **前提（掴めない帯であること）を先に確かめる**（レビュー ℹ️）＝`locked` の配線が外れて
    // 掴める帯になると、`usePointerDrag` 側の `preventDefault` で**緑のまま通ってしまう**
    // （この関門を狙ったテストが空振りになる）。掴める帯には `--editable` が付く。
    expect(document.querySelector(".timeline-clip")?.className).not.toContain("timeline-clip--editable");
    expect(pressClip()).toEqual({ found: true, prevented: true });
  });

  // ⚠️ **3つ目の条件も同じ側**（レビュー ℹ️）＝`grabbableClip` は書き出し中も掴めない扱いにする。
  // 2つだけ留めると「条件が3つある」ことが読めず、次に条件が増えたとき同じ穴が空く。
  it("書き出し中の帯（掴めない）", () => {
    useTimelineStore.setState({ doc: doc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {} });
    useTimelineStore.setState({ exportRun: { phase: "rendering", percent: 0, message: null, cancelling: false } });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(pressClip()).toEqual({ found: true, prevented: true });
  });

  // #950：**前に押した所からも手を降ろす**。焦点を「帯へ移さない」だけだと、`Space` の行き先が
  // 直前に押したボタンに残り、押した場所によって別のことが起きる（型から外れる）。
  it("前に押したボタンから手を降ろす（Space が別のことをしない）", () => {
    useTimelineStore.setState({ doc: doc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {} });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // どれでもよいので画面のボタンへ手を移す（利用者がマウスで押した状態を作る）。
    // ⚠️ **押せるボタンを選ぶ**＝`disabled` の要素は焦点を持てないので、前提が立たない。
    const someButton = [...container.querySelectorAll("button:not(.timeline-clip)")]
      .find((b) => !(b as HTMLButtonElement).disabled) as HTMLElement;
    someButton.focus();
    expect(document.activeElement).toBe(someButton); // 前提が立っていることを確かめてから見る
    pressClip();
    expect(document.activeElement).not.toBe(someButton);
  });

  // ⚠️ **掴めない帯でも降ろす**（レビュー ℹ️）＝`blur()` を `grabbableClip` の判定より**後ろ**へ
  // 動かすと、掴める帯のテストだけでは通ってしまう（位置を留めていない）。固定した列で見る。
  it("固定した列の帯でも、前に押した所から手を降ろす", () => {
    useTimelineStore.setState({
      doc: doc({ tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked: true }] }),
      loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {},
    });
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const someButton = [...container.querySelectorAll("button:not(.timeline-clip)")]
      .find((b) => !(b as HTMLButtonElement).disabled) as HTMLElement;
    someButton.focus();
    expect(document.activeElement).toBe(someButton);
    pressClip();
    expect(document.activeElement).not.toBe(someButton);
  });

  // ⚠️ **右クリックのメニューが消えていないこと**（レビュー 🟡）＝既定を全ボタンで落とすので、
  // `pointerdown` → `contextmenu` の**順に**通してメニューが開くところまで見る
  //（`fireEvent.contextMenu` の直撃だけだと、この順序で壊れても気づけない）。
  it("右ボタンでも既定は落ちるが、メニューは開く", async () => {
    useTimelineStore.setState({ doc: doc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {} });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const clip = document.querySelector(".timeline-clip") as HTMLElement;
    const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 2, buttons: 2 });
    clip.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    fireEvent.contextMenu(clip, { clientX: 10, clientY: 10 });
    expect(await screen.findByRole("button", { name: DUPLICATE_LABEL })).toBeTruthy();
  });

  // ⚠️ 同じく壊れていた側＝再生中も掴めない扱い（`grabbableClip` が `!isPlaying` を見る）。
  // ⚠️ **状態を直接立てる**＝再生ボタンを押す形だと、押せていなくても「止まっている帯」を
  // 見ているだけになり、**変異チェックで落ちない空振りのテスト**になる（実際に一度そうなった）。
  it("再生中の帯（掴めない）", () => {
    useTimelineStore.setState({ doc: doc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {}, isPlaying: true });
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(useTimelineStore.getState().isPlaying).toBe(true); // 前提が立っていることを確かめてから見る
    expect(pressClip()).toEqual({ found: true, prevented: true });
  });
});

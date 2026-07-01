// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TRANSITION_DIRECTION, TRANSITION_TYPE } from "../../domain/enums";
import type { Timeline } from "../../domain/project/compileTimeline";
import { TimelineView } from "./TimelineView";

function sampleTimeline(): Timeline {
  return {
    totalSec: 11,
    scenes: [
      { sceneId: "s1", startSec: 0, endSec: 8, order: 0 },
      { sceneId: "s2", startSec: 6, endSec: 11, order: 1 },
    ],
    tracks: {
      video: [
        { id: "s1", sceneId: "s1", startSec: 0, endSec: 8, label: "場面 1" },
        { id: "s2", sceneId: "s2", startSec: 6, endSec: 11, label: "場面 2" },
      ],
      telop: [{ id: "s1/l1", sceneId: "s1", lineId: "l1", startSec: 0, endSec: 8, label: "字幕テキスト" }],
      audio: [{ id: "s1/l1", sceneId: "s1", lineId: "l1", startSec: 0, endSec: 8, label: "セリフテキスト" }],
      bgm: [{ id: "bgm", startSec: 0, endSec: 11, label: "BGM" }],
    },
    transitions: [
      { fromSceneId: "s1", toSceneId: "s2", type: TRANSITION_TYPE.fade, direction: TRANSITION_DIRECTION.left, atSec: 6, durationSec: 2 },
    ],
  };
}

describe("TimelineView", () => {
  it("場面/テロップ/音声のクリップと遷移マーカーを表示する", () => {
    render(<TimelineView timeline={sampleTimeline()} />);
    expect(screen.getByTestId("timeline-view")).toBeInTheDocument();
    expect(screen.getByText("場面 1")).toBeInTheDocument();
    expect(screen.getByText("場面 2")).toBeInTheDocument();
    expect(screen.getByText("字幕テキスト")).toBeInTheDocument();
    expect(screen.getByText("セリフテキスト")).toBeInTheDocument();
    // 遷移（重なり）マーカーは種別を言い換えて title に出す（§2-3：FFmpeg 名や enum 値は出さない）。
    expect(screen.getByTitle(/フェード/)).toBeInTheDocument();
    // レーンのラベル（テロップ/音声）。
    expect(screen.getByText("テロップ")).toBeInTheDocument();
    expect(screen.getByText("音声")).toBeInTheDocument();
  });

  it("ズームの操作ボタンがある", () => {
    render(<TimelineView timeline={sampleTimeline()} />);
    expect(screen.getByLabelText("表示を広げる")).toBeInTheDocument();
    expect(screen.getByLabelText("表示を縮める")).toBeInTheDocument();
  });

  it("場面が無ければ案内を出す（空状態）", () => {
    const empty: Timeline = { totalSec: 0, scenes: [], tracks: { video: [], telop: [], audio: [], bgm: [] }, transitions: [] };
    render(<TimelineView timeline={empty} />);
    expect(screen.getByTestId("timeline-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("timeline-view")).not.toBeInTheDocument();
  });

  it("編集モードでは overlay 由来クリップだけ選択でき、選択がハイライトされる", () => {
    const tl = sampleTimeline();
    tl.tracks.telop.push({ id: "ovclip_001", sceneId: "s1", startSec: 1, endSec: 4, label: "追加テロップ", origin: "overlay" });
    const onSelect = vi.fn();
    const { rerender } = render(<TimelineView timeline={tl} editable onSelectClip={onSelect} />);
    // overlay 由来クリップは pointerdown で選択（ドラッグ開始も兼ねる）。
    fireEvent.pointerDown(screen.getByText("追加テロップ"), { clientX: 10, pointerId: 1 });
    fireEvent.pointerUp(screen.getByText("追加テロップ"), { clientX: 10, pointerId: 1 });
    expect(onSelect).toHaveBeenLastCalledWith("ovclip_001");
    // 場面射影クリップ（origin 無し）は選択せず、空領域扱いで選択解除（null）。
    fireEvent.click(screen.getByText("字幕テキスト"));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    // 選択中はハイライト class が付く。
    rerender(<TimelineView timeline={tl} editable selectedClipId="ovclip_001" onSelectClip={onSelect} />);
    expect(screen.getByText("追加テロップ").className).toContain("timeline-clip--selected");
  });

  it("編集モードで overlay クリップ本体をドラッグすると onClipDrag(id, 'move', deltaSec) が確定する", () => {
    const tl = sampleTimeline();
    tl.tracks.telop.push({ id: "ovclip_001", sceneId: "s1", startSec: 1, endSec: 4, label: "追加テロップ", origin: "overlay" });
    const onDrag = vi.fn();
    render(<TimelineView timeline={tl} editable onClipDrag={onDrag} />);
    const clip = screen.getByText("追加テロップ");
    // 既定ズーム pxPerSec=36。本体を +72px ドラッグ → move で +2秒。（window リスナへは要素からバブルで到達）
    fireEvent.pointerDown(clip, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(clip, { clientX: 172, pointerId: 1 });
    fireEvent.pointerUp(clip, { clientX: 172, pointerId: 1 });
    expect(onDrag).toHaveBeenCalledWith("ovclip_001", "move", 2);
  });

  it("右端ハンドルのドラッグで onClipDrag(id, 'trim-end', deltaSec) が確定する", () => {
    const tl = sampleTimeline();
    tl.tracks.telop.push({ id: "ovclip_001", sceneId: "s1", startSec: 1, endSec: 4, label: "追加テロップ", origin: "overlay" });
    const onDrag = vi.fn();
    const { container } = render(<TimelineView timeline={tl} editable onClipDrag={onDrag} />);
    const handle = container.querySelector(".timeline-clip-handle--right") as HTMLElement;
    fireEvent.pointerDown(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 136, pointerId: 1 }); // +36px = +1秒
    fireEvent.pointerUp(handle, { clientX: 136, pointerId: 1 });
    expect(onDrag).toHaveBeenCalledWith("ovclip_001", "trim-end", 1);
  });

  it("左端トリミングのプレビューは右端を固定する（0秒クランプ時に膨張しない）", () => {
    const tl = sampleTimeline();
    // startSec 0・長さ3秒（右端 px = 108 at pxPerSec 36）の overlay クリップ。
    tl.tracks.telop.push({ id: "ovclip_001", sceneId: "s1", startSec: 0, endSec: 3, label: "先頭テロップ", origin: "overlay" });
    const { container } = render(<TimelineView timeline={tl} editable onClipDrag={vi.fn()} />);
    const leftHandle = container.querySelector(".timeline-clip-handle--left") as HTMLElement;
    fireEvent.pointerDown(leftHandle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(leftHandle, { clientX: 50, pointerId: 1 }); // -50px（先頭より左＝0でクランプ）
    // 右端固定：left=0・width=右端(108)。膨張しない（旧実装は width 158px になっていた）。
    const clipEl = screen.getByText("先頭テロップ");
    expect(clipEl.style.left).toBe("0px");
    expect(clipEl.style.width).toBe("108px");
  });

  it("移動0で離した場合は onClipDrag を呼ばない（無駄な履歴を作らない）", () => {
    const tl = sampleTimeline();
    tl.tracks.telop.push({ id: "ovclip_001", sceneId: "s1", startSec: 1, endSec: 4, label: "追加テロップ", origin: "overlay" });
    const onDrag = vi.fn();
    render(<TimelineView timeline={tl} editable onClipDrag={onDrag} />);
    const clip = screen.getByText("追加テロップ");
    fireEvent.pointerDown(clip, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(clip, { clientX: 100, pointerId: 1 });
    expect(onDrag).not.toHaveBeenCalled();
  });
});

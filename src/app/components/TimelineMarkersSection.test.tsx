// @vitest-environment jsdom
// 時間の一点に置く**目印**（#356 ①）の画面。
//
// ⚠️ **動画には出ない**ことを、名前と説明の両方で言う＝「印を置いたら動画に出る」と思わせない。
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TimelineMarkersSection } from "./TimelineMarkersSection";
import { MARKER_TEXT_MAX } from "../../domain/timeline/markers";
import { PROJECT_FORMAT, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineMarker, TimelineProject } from "../../domain/timeline/types";

function doc(markers?: TimelineMarker[]): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: PROJECT_FORMAT.timeline,
    projectId: "proj_20260914_001",
    projectName: "テスト",
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets: [],
    tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
    clips: [],
    ...(markers ? { markers } : {}),
  };
}

const noop = { onAdd: vi.fn(), onJump: vi.fn(), onText: vi.fn(), onRemove: vi.fn() };

describe("目印の欄（#356 ①）", () => {
  // ⚠️ **動画には出ないことを、置く前に言う**＝押してから気づくことにしない（§2-5）。
  it("動画に出ないと書いてある（見出しにも、まだ無いときの案内にも）", () => {
    render(<TimelineMarkersSection doc={doc()} playheadSec={0} {...noop} />);
    // 見出しと、まだ無いときの案内の**両方**で言う（片方だけだと読み飛ばされる）。
    expect(screen.getAllByText(/動画には出ません/).length, '片方でしか言っていない').toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/目印（動画には出ません）/)).toBeTruthy();
  });

  it("まだ無いときは、何のために置くのかを出す（空の一覧を見せない）", () => {
    render(<TimelineMarkersSection doc={doc()} playheadSec={0} {...noop} />);
    expect(screen.getByText(/まだ目印はありません/)).toBeTruthy();
  });

  it("置くボタンで、いまの位置に置く", () => {
    const onAdd = vi.fn();
    render(<TimelineMarkersSection doc={doc()} playheadSec={4} {...noop} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: "いまの位置に目印を置く" }));
    expect(onAdd).toHaveBeenCalled();
  });

  // ⚠️ **辿れることが本体**＝置くだけにしない。
  it("時刻を押すと、その位置へ移る", () => {
    const onJump = vi.fn();
    render(<TimelineMarkersSection doc={doc([{ id: "marker_001", timeSec: 7 }])} playheadSec={0} {...noop} onJump={onJump} />);
    fireEvent.click(screen.getByTitle("この目印の位置へ移ります"));
    expect(onJump).toHaveBeenCalledWith(7);
  });

  it("時刻順に並べる（置いた順ではない）", () => {
    const markers = [{ id: "marker_001", timeSec: 9 }, { id: "marker_002", timeSec: 2 }];
    render(<TimelineMarkersSection doc={doc(markers)} playheadSec={0} {...noop} />);
    const buttons = screen.getAllByTitle("この目印の位置へ移ります");
    expect(buttons[0]!.textContent).toContain("0:02");
  });

  // ⚠️ **離れたときに書き込む**＝打つたびに履歴へ積まない（取り消しが1文字ずつになる）。
  it("メモは離れたときに書き込む（打つたびに積まない）", () => {
    const onText = vi.fn();
    render(<TimelineMarkersSection doc={doc([{ id: "marker_001", timeSec: 3 }])} playheadSec={0} {...noop} onText={onText} />);
    const input = screen.getByPlaceholderText(/メモ/);
    fireEvent.change(input, { target: { value: "ここ直す" } });
    expect(onText, "打つたびに書き込んでいる").not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onText).toHaveBeenCalledWith("marker_001", "ここ直す");
  });

  // ⚠️ **上限は欄そのものにも持たせる**＝超える入力を打てないようにする（切られて驚かせない）。
  it("メモの欄に上限がある", () => {
    render(<TimelineMarkersSection doc={doc([{ id: "marker_001", timeSec: 3 }])} playheadSec={0} {...noop} />);
    expect((screen.getByPlaceholderText(/メモ/) as HTMLInputElement).maxLength).toBe(MARKER_TEXT_MAX);
  });

  it("消せる", () => {
    const onRemove = vi.fn();
    render(<TimelineMarkersSection doc={doc([{ id: "marker_001", timeSec: 3 }])} playheadSec={0} {...noop} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(onRemove).toHaveBeenCalledWith("marker_001");
  });

  // ⚠️ **押せない理由を出す**（§2-5）＝書き出し中などに黙って効かないボタンを置かない。
  it("編集できないときは、理由つきで押せない", () => {
    render(<TimelineMarkersSection doc={doc([{ id: "marker_001", timeSec: 3 }])} playheadSec={0} {...noop} busy={{ disabled: true, title: "いま書き出しています" }} />);
    const add = screen.getByRole("button", { name: "いまの位置に目印を置く" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe("いま書き出しています");
    expect((screen.getByPlaceholderText(/メモ/) as HTMLInputElement).disabled).toBe(true);
  });

  it("いまの再生位置を見せる（押す前にどこへ置くか分かる）", () => {
    render(<TimelineMarkersSection doc={doc()} playheadSec={65} {...noop} />);
    expect(screen.getByText(/いまの再生位置：1:05/)).toBeTruthy();
  });
});

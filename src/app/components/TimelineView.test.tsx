// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
});

// @vitest-environment jsdom
// 声をまとめて作っている間は、**どの画面にいても**進み具合と中止が見える（#1024 ⑤）。
//
// ⚠️ **書き出しは同じ理由で全画面バナーを持っている**（#547 P2-1・`15 §4`）のに、声の一括作成には
// 効いていなかった＝置いてある3画面を離れると「止まった」ように見え、二重に押す引き金になる。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BulkVoiceBanner } from "./BulkVoiceBanner";
import { BulkVoiceControls } from "./BulkVoiceControls";
import { useSceneBulkVoice, useTimelineBulkVoice } from "../hooks/useBulkVoiceSource";
import { useTimelineStore } from "../store/timelineStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import { useProjectStore } from "../store/projectStore";

/** 出どころは画面と同じ経路（場面形式）で通す（#1019 ⑥）。 */
function Controls() {
  return <BulkVoiceControls source={useSceneBulkVoice()} />;
}

/** 声が要る場面を2つ持ち、1つだけできている状態にする。 */
function scenesWithVoice() {
  useProjectStore.getState().newProject();
  useProjectStore.setState({
    scenes: [
      { sceneId: "scene_001", sceneType: "opening", templateId: "tmpl_opening_001", durationSec: 5, texts: {}, assetRefs: {},
        narration: { text: "あ", status: "generated", voicePath: "a.wav" } },
      { sceneId: "scene_002", sceneType: "closing", templateId: "tmpl_closing_001", durationSec: 5, texts: {}, assetRefs: {},
        narration: { text: "い", status: "none" } },
    ] as never,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  scenesWithVoice();
  useProjectStore.setState({ isGeneratingNarration: false, narrationCancelled: false });
});

describe("声をまとめて作っている間の全画面バナー（#1024 ⑤）", () => {
  it("作っていないときは出さない", () => {
    render(<BulkVoiceBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("作っている間は進み具合と中止を出す", () => {
    useProjectStore.setState({ isGeneratingNarration: true });
    render(<BulkVoiceBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("声 1/2");
    expect(screen.getByRole("button", { name: "中止する" })).toBeInTheDocument();
  });

  // ⚠️ **待つ以外の次の行動を言う**（§2-5）＝この状態は書き出しを止める。
  it("何が止まっているかも言う", () => {
    useProjectStore.setState({ isGeneratingNarration: true });
    render(<BulkVoiceBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("書き出しは、声ができてから始められます");
  });

  it("中止を押すと、作成が打ち切られる", () => {
    useProjectStore.setState({ isGeneratingNarration: true });
    render(<BulkVoiceBanner />);
    fireEvent.click(screen.getByRole("button", { name: "中止する" }));
    expect(useProjectStore.getState().isGeneratingNarration).toBe(false);
  });

  // ⚠️ **二重に見せない**＝操作が画面に出ているなら、そちらに進み具合がある。
  it("画面に操作が出ているときは出さない", () => {
    useProjectStore.setState({ isGeneratingNarration: true });
    render(
      <>
        <BulkVoiceBanner />
        <Controls />
      </>,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  // ⚠️ **画面の名前で数えていない**＝操作が外れれば、また出る（画面を足しても配り忘れない）。
  it("操作が画面から外れたら、また出る", () => {
    useProjectStore.setState({ isGeneratingNarration: true });
    const { rerender } = render(
      <>
        <BulkVoiceBanner />
        <Controls />
      </>,
    );
    expect(screen.queryByRole("status")).toBeNull();
    rerender(
      <>
        <BulkVoiceBanner />
      </>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("声 1/2");
  });
});

// **両方の形式を見る**（#1019 ⑥・PR #1044 レビュー）。
//
// ⚠️ タイムライン形式にも一括作成ができた以上、`06 §9.0.1`（どの画面にいても進み具合と中止）は
// そちらにも及ぶ。見ていなかった間は、欄を閉じただけで**走っているのにどこにも出ない**＝
// #1024 ⑤ が直した症状がそのまま再発していた。
function TimelineControls() {
  return <BulkVoiceControls source={useTimelineBulkVoice()} />;
}

function timelineDocWithVoice() {
  useTimelineStore.setState({
    doc: {
      schemaVersion: TIMELINE_SCHEMA_VERSION,
      format: PROJECT_FORMAT.timeline,
      projectId: "proj_20260906_001",
      projectName: "テスト",
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
      videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
      voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
      assets: [],
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 0, durationSec: 3, voice: { text: "あ", status: "generated" } },
        { id: "clip_002", kind: TIMELINE_CLIP_KIND.voice, trackId: "track_002", startSec: 3, durationSec: 3, voice: { text: "い", status: "none" } },
      ],
    },
    isGeneratingVoices: false,
    voicesCancelled: false,
  } as never);
}

describe("タイムライン形式のまとめて作るも、全画面バナーに出る（#1019 ⑥）", () => {
  beforeEach(() => {
    timelineDocWithVoice();
    useProjectStore.setState({ isGeneratingNarration: false });
  });

  it("作っている間は進み具合と中止を出す", () => {
    useTimelineStore.setState({ isGeneratingVoices: true } as never);
    render(<BulkVoiceBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("声 1/2");
  });

  it("中止を押すと、作成が打ち切られる", () => {
    useTimelineStore.setState({ isGeneratingVoices: true } as never);
    render(<BulkVoiceBanner />);
    fireEvent.click(screen.getByRole("button", { name: "中止する" }));
    expect(useTimelineStore.getState().isGeneratingVoices).toBe(false);
  });

  // ⚠️ **形式ごとに数える**＝片方の操作が画面に出ているだけで、もう片方まで引っ込めない。
  it("場面形式の操作が出ていても、タイムライン形式のぶんは出す", () => {
    useTimelineStore.setState({ isGeneratingVoices: true } as never);
    render(
      <>
        <BulkVoiceBanner />
        <Controls />
      </>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("声 1/2");
  });

  it("タイムライン形式の操作が出ているときは、そのぶんは出さない", () => {
    useTimelineStore.setState({ isGeneratingVoices: true } as never);
    render(
      <>
        <BulkVoiceBanner />
        <TimelineControls />
      </>,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  // ⚠️ **同時に走りうる**（2つの形式は同時に開いたままが正規の状態）＝走っているぶんだけ並べる。
  it("両方走っていれば、2つ並べる", () => {
    useProjectStore.setState({ isGeneratingNarration: true });
    useTimelineStore.setState({ isGeneratingVoices: true } as never);
    render(<BulkVoiceBanner />);
    expect(screen.getAllByRole("status")).toHaveLength(2);
  });
});


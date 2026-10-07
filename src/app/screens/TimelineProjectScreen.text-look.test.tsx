// @vitest-environment jsdom
// 文字の体裁は畳んで出す（#1032）。
//
// ⚠️ 字間・行間・影・帯は項目が多く、開きっぱなしだと**文字を直すたびに下へ長くなる**。
//    字幕の部品は既に同じ形（「字幕の見た目」）で畳んでいるので、**同じものを部品で別の出し方にしない**（ADR-0026②）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { useExportLockStore } from "../store/exportLock";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";
import { TimelineProjectScreen } from "./TimelineProjectScreen";

function doc(over: Partial<TimelineProject> = {}): TimelineProject {
  return {
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
  };
}

const open = (over: Partial<TimelineProject> = {}) =>
  useTimelineStore.setState({ doc: doc(over), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: ["clip_001"], assetSrcById: {} } as never);

/** 見出しでたどれる節（`<details>`）。 */
const section = (title: string): HTMLDetailsElement =>
  screen.getByText(title).closest("details") as HTMLDetailsElement;

describe("タイムライン編集：文字の体裁は畳んで出す（#1032）", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useExportLockStore.setState({ owner: null });
    useTimelineStore.setState({ exportRun: { phase: "idle", percent: 0, message: null, cancelling: false } } as never);
    useTimelineStore.setState({ _voiceRun: null, generatingVoiceClipId: null } as never);
    useTimelineStore.getState().closeTimelineProject();
    useProjectStore.setState({ templates: [] });
    localStorage.clear();
  });

  it("何も入れていなければ畳んで出す（文字を直すたびに下へ長くならない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(section("文字の体裁").open, "既定で開いている").toBe(false);
  });

  it("体裁に手が入っているときは開いて出す（入れた設定を見失わない）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "こんにちは", letterSpacing: 0.2 },
      ],
    } as Partial<TimelineProject>);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(section("文字の体裁").open, "入れてあるのに畳んでいる").toBe(true);
  });

  // ⚠️ **4つの項目をそれぞれ見る**（PR #1081 レビュー）＝代表の1件だけだと、
  // **他の項を落とす変異が生き残る**（入れた設定が畳まれたままになる項目ができる）。
  it.each([
    ["行間", { lineHeight: 1.4 }],
    ["影", { shadow: { enabled: true } }],
    ["背景帯", { background: { enabled: true } }],
  ])("%s を入れてあれば開いて出す", (_name, over) => {
    open({
      clips: [
        {
          id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5,
          x: 0, y: 0, w: 100, h: 50, text: "こんにちは", ...(over as object),
        },
      ],
    } as Partial<TimelineProject>);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(section("文字の体裁").open, "入れてあるのに畳んでいる").toBe(true);
  });

  it("大きさ・色などの基本は畳まない（毎回触るもの）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const look = section("文字の体裁");
    // 「中身」の節は開いたままで、基本の欄はその中に直に出る。
    expect(look.textContent, "基本の欄まで畳んでいる").not.toContain("文字の大きさ");
    expect(screen.getByText("文字の大きさ")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
// 注意の件数を、いつも見える所に出す（#1032）。
//
// ⚠️ 知らせは**帯の器（76vh）の下**にあり、編集している間は画面外だった＝
//    見えていない知らせは無いのと同じ（`EditorToolbar` の注記と同じ理由）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
    tracks: [
      { id: "track_001", kind: TRACK_KIND.visual },
      { id: "track_002", kind: TRACK_KIND.audio },
    ],
    clips: [
      { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "こんにちは" },
    ],
    ...over,
  };
}

const open = (over: Partial<TimelineProject> = {}) =>
  useTimelineStore.setState({ doc: doc(over), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {} });

/** 見出しの行（貼り付いている＝スクロールしても消えない）の中にあるか。 */
const inStickyHead = (el: Element): boolean => el.closest(".editor-header") != null;

describe("タイムライン編集：注意の件数を見出しの行に出す（#1032）", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useExportLockStore.setState({ owner: null });
    useTimelineStore.setState({ exportRun: { phase: "idle", percent: 0, message: null, cancelling: false } });
    useTimelineStore.setState({ _voiceRun: null, generatingVoiceClipId: null });
    useTimelineStore.getState().closeTimelineProject();
    useProjectStore.setState({ templates: [] });
    localStorage.clear();
  });

  it("直すと良くなる知らせがあるとき、件数を見出しの行に出す", () => {
    // 見た目パターンが見つからない部品＝知らせが1件出る。
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_missing" },
      ],
    } as Partial<TimelineProject>);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const badge = screen.getByRole("button", { name: /注意 \d+件/ });
    expect(inStickyHead(badge), "件数がスクロールで消える所にある").toBe(true);
  });

  it("知らせが無いときは出さない（何も無いのに注意 0件を並べない）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /注意 \d+件/ })).toBeNull();
  });

  it("押すと知らせまで寄る（数だけ見せて、読むのは元の場所で）", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_missing" },
      ],
    } as Partial<TimelineProject>);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /注意 \d+件/ }));
    expect(scrollIntoView, "押しても知らせまで寄らない").toHaveBeenCalled();
  });

  // ⚠️ **出ているのに数えていない項を作らない**（PR #1076 レビュー）。
  // 「音が出せない素材」は自分の知らせを出すのに、合計に入っていなかった。
  // ⚠️ この種の漏れは**変異チェックでは見つからない**（壊せるのは「ある項」だけ）。
  it("音が出せない素材だけのときも、件数に入る", () => {
    open({
      assets: [{ assetId: "asset_001", assetType: "bgm", displayName: "消えたBGM", filePath: "assets/bgm.mp3", tags: [] }],
      tracks: [{ id: "track_002", kind: TRACK_KIND.audio }],
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.audio, trackId: "track_002", startSec: 0, durationSec: 5, assetId: "asset_001" },
      ],
    } as Partial<TimelineProject>);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    // 知らせ自体は出ている。
    expect(screen.getByText(/音が出せない素材があります/)).toBeInTheDocument();
    // その知らせが件数にも入っている（見出しの行に印が出る）。
    expect(screen.getByRole("button", { name: /注意 \d+件/ }), "出ている知らせが件数に入っていない").toBeInTheDocument();
  });

  it("知らせの中身は見出しの行へ出さない（編集の場所を上から狭めない）", () => {
    open({
      clips: [
        { id: "clip_001", kind: TIMELINE_CLIP_KIND.template, trackId: "track_001", startSec: 0, durationSec: 5, templateId: "tmpl_missing" },
      ],
    } as Partial<TimelineProject>);
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const head = container.querySelector(".editor-header") as HTMLElement;
    expect(head, "見出しの行が見つからない").not.toBeNull();
    expect(head.textContent).not.toMatch(/見た目パターン/);
  });
});

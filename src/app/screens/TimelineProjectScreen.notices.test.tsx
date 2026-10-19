// @vitest-environment jsdom
// 操作のあとの知らせ（#1385）と開いたときの知らせ（ADR-0057）が**画面に出る**こと。
// ⚠️ store に値が入るだけでは利用者に届かない＝以前は `editNotice` をどの画面も描いておらず、store の検査だけ緑だった（#1386 レビュー 🔴）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<typeof import("@tauri-apps/api/core")>()),
  invoke: vi.fn(async () => undefined),
}));
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { EXPORT_RUN_PHASE } from "../../domain/export/exportProgress";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";
import { reorientNotice, silenceAppliedMessage } from "../uiLabels";

const doc = (): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline, projectId: "proj_20261008_001", projectName: "テスト",
  createdAt: "2026-10-08T00:00:00.000Z", updatedAt: "2026-10-08T00:00:00.000Z",
  videoSettings: { aspectRatio: "9:16", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
  clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
} as unknown as TimelineProject);

const open = (over: Record<string, unknown>) => {
  useProjectStore.setState({ templates: [] });
  useTimelineStore.setState({
    doc: doc(), loadError: null, isLoading: false, playheadSec: 0, isPlaying: false,
    selectedClipIds: [], assetSrcById: {}, videoSrcById: {}, editBlocked: null, importError: null,
    history: { past: [], future: [] }, editNotice: null, openNotice: null, ...over,
  } as never);
  render(<TimelineProjectScreen onNavigate={vi.fn()} />);
};

beforeEach(() => {
  localStorage.clear();
  useTimelineStore.setState({ exportRun: { ...useTimelineStore.getState().exportRun, phase: EXPORT_RUN_PHASE.idle } } as never);
});

describe("知らせが画面に出る", () => {
  it("操作のあとの知らせ（無音を詰めた）が出る", () => {
    const text = silenceAppliedMessage(2, 3.5);
    open({ editNotice: text });
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("開いたときの知らせは、部品を選んでも残り、「閉じる」で消える", () => {
    const text = reorientNotice(1, 0, 2);
    open({ openNotice: text });
    expect(screen.getByText(text)).toBeInTheDocument();
    act(() => useTimelineStore.getState().selectClip("clip_001"));
    expect(screen.getByText(text)).toBeInTheDocument();
    fireEvent.click(screen.getByText(text).parentElement!.querySelector("button")!);
    expect(screen.queryByText(text)).toBeNull();
  });
});

// ⚠️ **枠に入りきらず「…」で切れる文字を画面で知らせる**（α 残件の洗い直し 2026-10-19）＝以前は起動の引数の書き出しだけが
//   知らせ、画面から書き出す人は切れた動画を黙って受け取っていた（場面形式は公開前チェックで出す＝ADR-0026②）。
describe("タイムライン：切れている文字の知らせ", () => {
  beforeEach(() => vi.useFakeTimers());

  const longText = (text: string) => ({
    ...doc(),
    clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 5,
      x: 0, y: 0, w: 100, h: 50, fontSize: 40, maxLines: 1, text }],
  });

  it("切れる文字があれば、編集が落ち着いたあとに注意を出す", () => {
    open({ doc: longText("とても長い見出しの文字がここに入ります") });
    expect(screen.queryByText(/末尾が「…」になります/)).toBeNull();
    // 編集が落ち着くまでは数えない（重いので、掴んで運ぶ間に毎回は回さない）。
    act(() => { vi.advanceTimersByTime(100); });
    expect(screen.queryByText(/末尾が「…」になります/), "落ち着く前に数えた").toBeNull();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(/末尾が「…」になります/)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("収まっていれば出さない", () => {
    open({ doc: longText("短い") });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByText(/末尾が「…」になります/)).toBeNull();
    vi.useRealTimers();
  });
});

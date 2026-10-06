// @vitest-environment jsdom
// 動きのひな形（#1349）＝「動き」の欄で選んで当てると、キーフレームの列へ展開して重なる・取り消し1回で戻る。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";

const doc = (): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: "proj_20261006_001",
  projectName: "テスト",
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
  clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 2, durationSec: 4, x: 0, y: 0, w: 100, h: 50, text: "あ" }],
} as unknown as TimelineProject);

const open = (playheadSec = 3) => {
  useProjectStore.setState({ templates: [] });
  useTimelineStore.setState({
    doc: doc(), loadError: null, isLoading: false, playheadSec, isPlaying: false,
    selectedClipIds: ["clip_001"], assetSrcById: {}, videoSrcById: {}, editBlocked: null,
    history: { past: [], future: [] }, _historyGroupDepth: 0,
  } as never);
  render(<TimelineProjectScreen onNavigate={vi.fn()} />);
  return within(screen.getByTestId("motion-presets"));
};
const kfs = () => useTimelineStore.getState().doc!.animations?.[0]?.keyframes ?? [];

beforeEach(() => localStorage.clear());

describe("動きのひな形（#1349）", () => {
  it("選んで当てると、選んだ長さでキーフレームが入る（登場＝帯の始まりから）", () => {
    const box = open();
    fireEvent.change(box.getByRole("combobox"), { target: { value: "in-pop" } });
    fireEvent.change(box.getByRole("spinbutton"), { target: { value: "1" } });
    fireEvent.blur(box.getByRole("spinbutton"));
    fireEvent.click(box.getByRole("button", { name: "当てる" }));
    expect(kfs().map((k) => k.timeSec)).toEqual([0, 1]);
    expect(kfs()[0].scale).toBeLessThan(1);
  });

  it("強調は再生位置から（帯の先頭からの秒に直す）", () => {
    const box = open(3); // 帯は 2 秒から＝帯の中の 1 秒
    fireEvent.change(box.getByRole("combobox"), { target: { value: "emph-zoom" } });
    fireEvent.click(box.getByRole("button", { name: "当てる" }));
    expect(kfs()[0].timeSec).toBe(1);
  });

  it("取り消し1回で、当てる前に戻る", () => {
    const box = open();
    fireEvent.change(box.getByRole("combobox"), { target: { value: "out-spin" } });
    fireEvent.click(box.getByRole("button", { name: "当てる" }));
    expect(kfs().length).toBeGreaterThan(0);
    act(() => useTimelineStore.getState().undo());
    expect(useTimelineStore.getState().doc!.animations ?? []).toEqual([]);
  });
});

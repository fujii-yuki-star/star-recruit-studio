// @vitest-environment jsdom
// Ctrl+D＝選んだ部品を複製（#1350・#1248 の残り・業界の型）。右クリックの「複製」と同じ入口・同じ断り。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { EDIT_BLOCKED } from "../../domain/timeline/edit";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";
import { SHORTCUT_KEYS, TIMELINE_SHORTCUTS } from "../timelineShortcuts";

const doc = (locked = false): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: "proj_20261006_001",
  projectName: "テスト",
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual, locked }, { id: "track_002", kind: TRACK_KIND.visual }],
  clips: [
    { id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 100, h: 50, text: "あ" },
    { id: "clip_002", kind: TIMELINE_CLIP_KIND.text, trackId: "track_002", startSec: 0, durationSec: 2, x: 0, y: 0, w: 100, h: 50, text: "い" },
  ],
} as unknown as TimelineProject);

const open = (selected: string[], locked = false) => {
  useProjectStore.setState({ templates: [] });
  useTimelineStore.setState({
    doc: doc(locked), loadError: null, isLoading: false, playheadSec: 0, isPlaying: false,
    selectedClipIds: selected, assetSrcById: {}, videoSrcById: {}, editBlocked: null,
    history: { past: [], future: [] },
  } as never);
  render(<TimelineProjectScreen onNavigate={vi.fn()} />);
};
const press = (): boolean => fireEvent.keyDown(window, { key: "d", ctrlKey: true });
const clips = () => useTimelineStore.getState().doc!.clips;

beforeEach(() => localStorage.clear());

describe("Ctrl+D で複製（#1350）", () => {
  it("1つ選んでいれば、すぐ後ろに複製して、それを選ぶ", () => {
    open(["clip_001"]);
    const notCancelled = press();
    expect(notCancelled).toBe(false); // 既定の動き（ブックマーク等）を止める
    expect(clips()).toHaveLength(3);
    const added = clips().find((c) => c.id !== "clip_001" && c.id !== "clip_002")!;
    expect([added.trackId, added.startSec]).toEqual(["track_001", 2]);
  });

  it("2つ以上選んでいれば複製せず、右クリックと同じ理由を出す", () => {
    open(["clip_001", "clip_002"]);
    press();
    expect(clips()).toHaveLength(2);
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.singleClipOnly);
  });

  it("固定した列の部品は複製せず、理由を出す", () => {
    open(["clip_001"], true);
    press();
    expect(clips()).toHaveLength(2);
    expect(useTimelineStore.getState().editBlocked?.reason).toBe(EDIT_BLOCKED.locked);
  });

  it("選んでいなければ奪わない（既定の動きに任せる）", () => {
    open([]);
    expect(press()).toBe(true);
    expect(clips()).toHaveLength(2);
  });

  it("一覧と右クリックのメニューに同じキーを出す", () => {
    expect(TIMELINE_SHORTCUTS.some((s) => s.keys === SHORTCUT_KEYS.duplicate && s.codes.includes("d"))).toBe(true);
    open(["clip_001"]);
    const clip = document.querySelector(".timeline-clip") as HTMLElement;
    fireEvent.contextMenu(clip, { clientX: 10, clientY: 10 });
    expect(screen.getByRole("menuitem", { name: /複製/ }).textContent).toContain(SHORTCUT_KEYS.duplicate);
  });
});

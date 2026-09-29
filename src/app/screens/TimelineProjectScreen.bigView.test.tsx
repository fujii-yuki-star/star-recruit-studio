// @vitest-environment jsdom
// 仕上がり確認を「大きく見る」（#1262）＝欄を広げ、アプリの窓も全画面にする。Esc・もう一度押す・画面を離れるで戻る。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const fullscreen = vi.fn(async (_on: boolean) => true);
vi.mock("../../infrastructure/appFullscreen", () => ({ setAppFullscreen: (on: boolean) => fullscreen(on) }));

import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";

const doc: TimelineProject = {
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: "proj_20260929_001",
  projectName: "テスト",
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
  clips: [{ id: "clip_001", kind: TIMELINE_CLIP_KIND.text, trackId: "track_001", startSec: 0, durationSec: 2, x: 0, y: 0, w: 10, h: 10, text: "あ" }],
};

beforeEach(() => {
  fullscreen.mockClear();
  localStorage.clear();
  useTimelineStore.setState({ doc, loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [] });
});

const previewFrame = () => document.querySelector('[data-panel-id="preview"]') as HTMLElement;

describe("仕上がり確認を大きく見る（#1262）", () => {
  it("押すと仕上がり確認を広げ、窓を全画面にする。もう一度で戻す", () => {
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "大きく見る" }));
    expect(previewFrame().className).toContain("panel-frame--maximized");
    expect(fullscreen).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "元に戻す", pressed: true }));
    expect(previewFrame().className).not.toContain("panel-frame--maximized");
    expect(fullscreen).toHaveBeenLastCalledWith(false);
  });

  it("Esc で戻る", () => {
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "大きく見る" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(previewFrame().className).not.toContain("panel-frame--maximized");
    expect(fullscreen).toHaveBeenLastCalledWith(false);
  });

  // ⚠️ **ほかの道で広げ方が変わったら、窓の全画面も解く**＝窓だけ全画面のまま、を作らない。
  it("見出しのボタンで仕上がり確認を戻しても、全画面を解く", () => {
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "大きく見る" }));
    fireEvent.click(screen.getByRole("button", { name: "仕上がり確認の欄を元に戻す" }));
    expect(fullscreen).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("button", { name: "大きく見る" })).toBeTruthy();
  });

  it("画面を離れたら全画面を解く", () => {
    const r = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "大きく見る" }));
    r.unmount();
    expect(fullscreen).toHaveBeenLastCalledWith(false);
  });

  it("大きく見ていないときは、画面を離れても全画面の API を呼ばない", () => {
    const r = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    r.unmount();
    expect(fullscreen).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
// 吸着は切替で切れる（#1032）。
//
// ⚠️ 以前は「`Ctrl` を押しながら動かすと吸着しません」という**説明だけ**で、
//    切るにはその一文を読むしかなかった（#819-3 で足した文）。押せば切れる形にする。
// ⚠️ **`Ctrl` は残す**（ADR-0034 決定）＝吸着を使いながら**その回だけ外したい**ときの道。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { useExportLockStore } from "../store/exportLock";
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";
import { TimelineProjectScreen } from "./TimelineProjectScreen";

const doc = (): TimelineProject => ({
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
});

const open = () =>
  useTimelineStore.setState({ doc: doc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {} } as never);

const snapSwitch = (): HTMLElement => screen.getByRole("switch", { name: "吸着" });

describe("タイムライン編集：吸着は切替で切れる（#1032）", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useExportLockStore.setState({ owner: null });
    useTimelineStore.setState({ exportRun: { phase: "idle", percent: 0, message: null, cancelling: false } } as never);
    useTimelineStore.setState({ _voiceRun: null, generatingVoiceClipId: null } as never);
    useTimelineStore.getState().closeTimelineProject();
    useProjectStore.setState({ templates: [] });
    localStorage.clear();
  });

  it("既定は入っている（これまでどおり寄せる）", () => {
    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(snapSwitch()).toHaveAttribute("aria-checked", "true");
  });

  it("切ると覚えていて、開き直しても切れたまま（毎回切り直させない）", () => {
    open();
    const first = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    fireEvent.click(snapSwitch());
    expect(snapSwitch()).toHaveAttribute("aria-checked", "false");
    first.unmount();

    open();
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    expect(snapSwitch(), "覚えていない").toHaveAttribute("aria-checked", "false");
  });

  it("`Ctrl` の案内は**画面に**出す（ホバーだけにしない）", () => {
    // ⚠️ **一度ホバーへ移して差し戻した**（#1104 レビュー由来 🟡・2026-09-10）＝高さを詰めるために
    // `title` だけにしたが、`06 §9.3` は「`title`（ホバー）だけに置かない＝タッチ・キーボードでは
    // 読めない」と名指しで禁じており、`06 §12.1` も「並びの欄の上に一文で置く」と決めていた。
    // ⚠️ **行は増やさない**＝同じ行の続きに短い一文として置く（3行に戻さない）。
    // ⚠️ **切っているときは言い方を変える**＝吸着していないのに「一時解除」は意味を成さない。
    open();
    const { container } = render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    const toolbar = () => container.querySelector(".timeline-toolbar")!.textContent ?? "";
    expect(toolbar(), "入っているのに `Ctrl` の道が画面に出ていない").toContain("Ctrl");
    expect(toolbar(), "何に寄るのかが画面から消えている").toContain("再生位置");
    fireEvent.click(snapSwitch());
    expect(toolbar(), "切っているのに一時解除の案内が残っている").not.toContain("Ctrl");
    expect(toolbar(), "切っているときに入れると何が起きるかを言っていない").toContain("そのまま置けます");
  });
});

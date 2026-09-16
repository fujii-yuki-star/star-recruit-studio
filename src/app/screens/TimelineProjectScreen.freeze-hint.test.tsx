// @vitest-environment jsdom
// 「この瞬間で絵を止める」の**押す前の予告**が、**2つの入口で同じ**であること（#1167）。
//
// ⚠️ 右クリック側だけ届いていなかった＝`ContextMenu` は `disabledHint`（押せないときだけ）しか
//    描かないのに `hint` を渡しており、**どこにも出ない死んだ受け渡し**だった。
//    渡していたので**型でも気づけず**（スプレッドの余剰プロパティは通る）、
//    「ボタンから押した人には出て、右クリックから押した人には出ない」状態だった（ADR-0026②）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TimelineProjectScreen } from "./TimelineProjectScreen";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { FREEZE_FRAME_LABEL } from "../uiLabels";
import { ASSET_TYPE, PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";

/** 元の音を鳴らしている動画の部品＝止めると音が止まる（知らせる相手が居る）。 */
const doc = (): TimelineProject => ({
  schemaVersion: TIMELINE_SCHEMA_VERSION,
  format: PROJECT_FORMAT.timeline,
  projectId: "proj_20260916_001",
  projectName: "テスト",
  createdAt: "2026-09-16T00:00:00.000Z",
  updatedAt: "2026-09-16T00:00:00.000Z",
  videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
  voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
  assets: [{ assetId: "asset_001", assetType: ASSET_TYPE.video, displayName: "動画", filePath: "assets/asset_001.mp4" }],
  tracks: [{ id: "track_001", kind: TRACK_KIND.visual }],
  clips: [{
    id: "clip_001", kind: TIMELINE_CLIP_KIND.slot, trackId: "track_001",
    startSec: 0, durationSec: 10, assetId: "asset_001", useOriginalAudio: true,
  }],
} as unknown as TimelineProject);

const open = () => {
  useProjectStore.setState({ templates: [] });
  useTimelineStore.setState({
    doc: doc(), loadError: null, isLoading: false, playheadSec: 5,
    selectedClipIds: ["clip_001"], assetSrcById: {}, videoSrcById: {}, editBlocked: null,
  } as never);
  render(<TimelineProjectScreen onNavigate={vi.fn()} />);
};

/** 帯を右クリックしてメニューを開く。 */
const openClipMenu = () => {
  const clip = document.querySelector(".timeline-clip") as HTMLElement;
  fireEvent.contextMenu(clip, { clientX: 10, clientY: 10 });
};

describe("「この瞬間で絵を止める」の予告（#1167）", () => {
  beforeEach(() => localStorage.clear());

  it("右クリックの項目にも予告が出る（この入口だけ黙っていない）", () => {
    open();
    openClipMenu();
    const item = screen.getByRole("menuitem", { name: FREEZE_FRAME_LABEL });
    expect(item.getAttribute("title") ?? "", "右クリックに予告が出ていない").toContain("元の音");
  });

  // ⚠️ **同じ操作は同じことを言う**（ADR-0026②）＝どちらかだけ直す、を構造で止める。
  it("ボタンと右クリックで、同じ予告を出す", () => {
    open();
    const button = screen.getByRole("button", { name: FREEZE_FRAME_LABEL });
    const buttonTitle = button.getAttribute("title");
    expect(buttonTitle, "ボタンに予告が出ていない").toBeTruthy();
    openClipMenu();
    const item = screen.getByRole("menuitem", { name: FREEZE_FRAME_LABEL });
    expect(item.getAttribute("title"), "入口によって言うことが違う").toBe(buttonTitle);
  });

  // ⚠️ **尺が伸びないことも両方で言う**（#1155 ⑥）＝他社は伸びるので、言わないと
  //    「思ったより短い」となった人の次の一歩が画面から読めない。
  it("尺が伸びないことも、両方の入口で言う", () => {
    open();
    expect(screen.getByRole("button", { name: FREEZE_FRAME_LABEL }).getAttribute("title") ?? "").toContain("長さは変わりません");
    openClipMenu();
    expect(screen.getByRole("menuitem", { name: FREEZE_FRAME_LABEL }).getAttribute("title") ?? "").toContain("長さは変わりません");
  });
});

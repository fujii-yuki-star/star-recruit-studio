// @vitest-environment jsdom
// 拡張パックの音楽を「音」の欄から一手で置く（2026-10-16 実機）。
//
// ⚠️ 以前は「よく使う素材」で取り込んでから「音」で置く二手だった＝同梱の曲は「音」から一手で置けるのに、
//    パックの曲だけ別の場所を探す必要があった（ADR-0026②＝同じ概念を割らない）。
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useTimelineStore } from "../store/timelineStore";
import { useProjectStore } from "../store/projectStore";
import { ASSET_TYPE, PROJECT_FORMAT, TRACK_KIND } from "../../domain/enums";
import { TIMELINE_SCHEMA_VERSION } from "../../domain/timeline/types";
import type { TimelineProject } from "../../domain/timeline/types";
import type { ExtensionPackManifest } from "../../domain/pack/extensionPack";
import { TimelineProjectScreen } from "./TimelineProjectScreen";

const doc = (assets: TimelineProject["assets"] = []): TimelineProject =>
  ({
    schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline,
    projectId: "proj_20261016_001", projectName: "テスト",
    createdAt: "2026-10-16T00:00:00.000Z", updatedAt: "2026-10-16T00:00:00.000Z",
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets,
    tracks: [{ id: "track_001", kind: TRACK_KIND.visual }, { id: "track_002", kind: TRACK_KIND.audio }],
    clips: [],
  }) as unknown as TimelineProject;

const pack = {
  schemaVersion: "1.0", packId: "office", name: "オフィス", version: "1.0.0", publisher: "社内", minAppVersion: "0.5.0",
  contents: { bgm: [{ bgmId: "drive", file: "b/drive.mp3", displayName: "試験のドライブ曲" }] },
  files: [], licenses: [{ target: "bgm", license: "CC0" }],
} as unknown as ExtensionPackManifest;

const openSound = () =>
  fireEvent.click(within(screen.getByRole("group", { name: "置くもの" })).getByRole("button", { name: "音" }));

describe("拡張パックの音楽を「音」の欄から置く", () => {
  it("同梱の曲と並んで出て、押すと取り込んでから、その素材を置く", async () => {
    const added = { assetId: "asset_001", assetType: ASSET_TYPE.bgm, displayName: "試験のドライブ曲", filePath: "assets/asset_001.mp3" };
    const importFromLibrary = vi.fn(async () => {
      useTimelineStore.setState({ doc: doc([added] as never) });
      return "asset_001";
    });
    const addAudioClip = vi.fn();
    useProjectStore.setState({ templates: [], packs: [pack] });
    useTimelineStore.setState({
      doc: doc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {}, editBlocked: null,
      importFromLibrary, addAudioClip,
    } as never);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openSound();
    fireEvent.click(screen.getByRole("button", { name: /試験のドライブ曲/ }));
    await waitFor(() => expect(addAudioClip).toHaveBeenCalled());
    expect(importFromLibrary).toHaveBeenCalledWith("pack_office__drive");
    expect(addAudioClip.mock.calls[0]![0]).toMatchObject({ assetId: "asset_001", trackId: "track_002" });
  });

  it("取り込みに失敗したら置かない", async () => {
    const addAudioClip = vi.fn();
    const importFromLibrary = vi.fn(async () => null);
    useProjectStore.setState({ templates: [], packs: [pack] });
    useTimelineStore.setState({
      doc: doc(), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {}, editBlocked: null,
      importFromLibrary, addAudioClip,
    } as never);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openSound();
    fireEvent.click(screen.getByRole("button", { name: /試験のドライブ曲/ }));
    await waitFor(() => expect(importFromLibrary).toHaveBeenCalled());
    expect(addAudioClip).not.toHaveBeenCalled();
  });

  it("もう取り込んである曲は、パックの側に二重に出さない（この動画の素材として出る）", () => {
    const added = { assetId: "asset_001", assetType: ASSET_TYPE.bgm, displayName: "試験のドライブ曲", filePath: "assets/asset_001.mp3" };
    useProjectStore.setState({ templates: [], packs: [pack] });
    useTimelineStore.setState({
      doc: doc([added] as never), loadError: null, isLoading: false, playheadSec: 0, selectedClipIds: [], assetSrcById: {}, editBlocked: null,
    } as never);
    render(<TimelineProjectScreen onNavigate={vi.fn()} />);
    openSound();
    expect(screen.getAllByRole("button", { name: /試験のドライブ曲/ })).toHaveLength(1);
  });
});

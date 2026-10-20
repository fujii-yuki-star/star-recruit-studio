// 拡張パックの音楽を動画へ取り込む（ADR-0060 段階2b）＝棚と同じ口で、両方の形式とも動画へコピーする。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../infrastructure/assetLibraryFs", () => ({
  listLibraryAssets: vi.fn(async () => []),
  copyLibraryAssetToProject: vi.fn(),
}));
vi.mock("../../infrastructure/packFs", () => ({
  listPackManifests: vi.fn(async () => []),
  readPackText: vi.fn(),
  readPackDataUrl: vi.fn(),
  copyPackFileToProject: vi.fn(async (_p: string, _r: string, _id: string, fileName: string) => `assets/${fileName}`),
}));
vi.mock("./assetImport", async (orig) => ({
  ...(await orig<typeof import("./assetImport")>()),
  probeImageSize: vi.fn(async () => null),
  probeAndThumbVideo: vi.fn(async () => ({})),
}));
vi.mock("../../infrastructure/projectFs", async (orig) => ({
  ...(await orig<typeof import("../../infrastructure/projectFs")>()),
  assetDisplayUrl: vi.fn(async () => null),
  saveTimelineProjectDoc: vi.fn(async () => {}),
}));

import { useProjectStore } from "./projectStore";
import { useTimelineStore } from "./timelineStore";
import { copyPackFileToProject } from "../../infrastructure/packFs";
import { copyLibraryAssetToProject, listLibraryAssets } from "../../infrastructure/assetLibraryFs";
import { ASSET_TYPE } from "../../domain/enums";
import type { ExtensionPackManifest } from "../../domain/pack/extensionPack";
import type { TimelineProject } from "../../domain/timeline/types";

const pack = {
  schemaVersion: "1.0", packId: "office", name: "音楽", version: "1.0.0", publisher: "社内", minAppVersion: "0.5.0",
  contents: { bgm: [{ bgmId: "morning", file: "bgm/morning.mp3", displayName: "朝の曲" }] },
  files: [{ path: "bgm/morning.mp3", sha256: "a".repeat(64) }],
  licenses: [{ target: "bgm", license: "CC0" }],
} as ExtensionPackManifest;

beforeEach(() => {
  useProjectStore.setState((st) => ({
    packs: [pack], assets: [], assetSrcById: {}, importError: null, isImporting: false,
    meta: { ...st.meta, projectId: "proj_20261014_001" },
  }) as never);
  useProjectStore.getState().setExportRun({ phase: "idle" });
  useTimelineStore.setState({
    doc: {
      format: "timeline", schemaVersion: "1.22", projectId: "proj_20261014_002", projectName: "t",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 300 },
      assets: [], tracks: [], clips: [],
    } as unknown as TimelineProject,
    isImporting: false, importError: null, exportRun: { phase: "idle" }, past: [], future: [],
  } as never);
});
afterEach(() => vi.clearAllMocks());

describe("拡張パックの音楽の取り込み", () => {
  it("場面形式：パックの中のファイルを動画へコピーし、普通の音の素材として足す（棚は読まない）", async () => {
    const id = await useProjectStore.getState().importFromLibrary("pack_office__morning");
    expect(id).toMatch(/^asset_\d{3}$/);
    const a = useProjectStore.getState().assets[0];
    expect(a).toMatchObject({ assetId: id, assetType: ASSET_TYPE.bgm, displayName: "朝の曲", filePath: `assets/${id}.mp3` });
    expect(copyPackFileToProject).toHaveBeenCalledWith("office", "bgm/morning.mp3", "proj_20261014_001", `${id}.mp3`);
    expect(listLibraryAssets).not.toHaveBeenCalled();
    expect(copyLibraryAssetToProject).not.toHaveBeenCalled();
  });

  it("タイムライン形式も同じ口で入る（形式で受けないことを作らない）", async () => {
    expect(await useTimelineStore.getState().importFromLibrary("pack_office__morning")).toBe("asset_001");
    const a = useTimelineStore.getState().doc!.assets[0];
    expect(a).toMatchObject({ assetType: ASSET_TYPE.bgm, displayName: "朝の曲" });
    expect(copyPackFileToProject).toHaveBeenCalledWith("office", "bgm/morning.mp3", "proj_20261014_002", expect.stringMatching(/^asset_\d{3}\.mp3$/));
  });

  it("外したパックの音楽は「見つかりませんでした」と断り、何も足さない", async () => {
    useProjectStore.setState({ packs: [] } as never);
    expect(await useProjectStore.getState().importFromLibrary("pack_office__morning")).toBeNull();
    expect(useProjectStore.getState().importError).toBe("この素材は見つかりませんでした。一覧を開き直してください。");
    expect(useProjectStore.getState().assets).toEqual([]);
    expect(useProjectStore.getState().isImporting).toBe(false);
  });
});

// 場面形式の書き出しで BGM の音をどこから渡すか（負荷・耐久の点検 2026-10-22）。
import { describe, expect, it, vi } from "vitest";
import { sceneBgmSource } from "./sceneBgmSource";
import { BGM_CATALOG } from "../../domain/bgm/bgmCatalog";

const assets = [{ assetId: "asset_001", filePath: "assets/asset_001.WAV" }];
const io = (missing: string[] = []) => ({
  readBundledBgmDataUrl: vi.fn(async () => "data:audio/mp3;base64,AAA"),
  missingAssetFiles: vi.fn(async () => missing),
});

describe("sceneBgmSource", () => {
  it("自分の BGM は中身を読まずパスで渡す（拡張子は小文字）", async () => {
    const r = await sceneBgmSource({ bundledBgmId: null, assetId: "asset_001" }, assets, "proj_1", io());
    expect(r).toEqual({ audioBase64: "", audioPath: "assets/asset_001.WAV", fileExt: "wav" });
  });

  it("自分の BGM が見つからなければ null（その区間は無音で続け、完了時に知らせる）", async () => {
    const r = await sceneBgmSource({ bundledBgmId: null, assetId: "asset_001" }, assets, "proj_1", io(["assets/asset_001.WAV"]));
    expect(r).toBeNull();
  });

  it("同梱の曲は今までどおり中身で渡す", async () => {
    const b = BGM_CATALOG[0]!;
    const r = await sceneBgmSource({ bundledBgmId: b.id, assetId: null }, assets, "proj_1", io());
    expect(r).toMatchObject({ audioBase64: "data:audio/mp3;base64,AAA" });
    expect(r!.audioPath).toBeUndefined();
  });

  it("保存前（動画の番号が無い）・素材が無い・同梱が読めないときは null", async () => {
    expect(await sceneBgmSource({ bundledBgmId: null, assetId: "asset_001" }, assets, null, io())).toBeNull();
    expect(await sceneBgmSource({ bundledBgmId: null, assetId: "asset_009" }, assets, "proj_1", io())).toBeNull();
    const none = { ...io(), readBundledBgmDataUrl: vi.fn(async () => undefined) };
    expect(await sceneBgmSource({ bundledBgmId: BGM_CATALOG[0]!.id, assetId: null }, assets, "proj_1", none)).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import type { Asset } from "../../domain/project/types";
import { sampleAssets } from "../../infrastructure/sampleData";
import { hasWorkInProgress, hasUnsavedChanges } from "./newProjectGuard";

describe("hasWorkInProgress", () => {
  it("場面が1つ以上あれば作業中", () => {
    expect(hasWorkInProgress(1, [])).toBe(true);
  });

  it("場面0・素材なしは作業中でない", () => {
    expect(hasWorkInProgress(0, [])).toBe(false);
  });

  it("サンプル素材だけなら作業中でない", () => {
    expect(hasWorkInProgress(0, sampleAssets)).toBe(false);
  });

  it("サンプル外の取り込み素材があれば作業中", () => {
    const custom: Asset = { ...sampleAssets[0], assetId: "asset_999" };
    expect(hasWorkInProgress(0, [custom])).toBe(true);
  });
});

describe("hasUnsavedChanges（#256 未保存検知）", () => {
  it("idle（編集後）で内容があれば未保存", () => {
    expect(hasUnsavedChanges("idle", 1, [])).toBe(true);
  });
  it("error（保存失敗）で内容があれば未保存（要再保存）", () => {
    expect(hasUnsavedChanges("error", 1, [])).toBe(true);
  });
  it("saved / saving は未保存でない", () => {
    expect(hasUnsavedChanges("saved", 1, [])).toBe(false);
    expect(hasUnsavedChanges("saving", 1, [])).toBe(false);
  });
  it("内容が無ければ（空の新規状態）idle でも未保存でない", () => {
    expect(hasUnsavedChanges("idle", 0, [])).toBe(false);
    expect(hasUnsavedChanges("idle", 0, sampleAssets)).toBe(false);
  });
});

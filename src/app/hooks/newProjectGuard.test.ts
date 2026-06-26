import { describe, it, expect } from "vitest";
import type { Asset } from "../../domain/project/types";
import { sampleAssets } from "../../infrastructure/sampleData";
import { hasWorkInProgress } from "./newProjectGuard";

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

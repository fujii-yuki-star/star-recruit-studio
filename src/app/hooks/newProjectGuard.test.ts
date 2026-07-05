import { describe, it, expect } from "vitest";
import type { Asset } from "../../domain/project/types";
import { sampleAssets } from "../../infrastructure/sampleData";
import { hasWizardBrief, hasWorkInProgress, hasUnsavedChanges } from "./newProjectGuard";

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

  it("ウィザード入力（会社名 or テーマ）があれば作業中（#401）", () => {
    expect(hasWorkInProgress(0, [], { companyInfo: { companyName: "株式会社A" } })).toBe(true);
    expect(hasWorkInProgress(0, [], { generalBrief: { title: "全社キックオフ" } as never })).toBe(true);
  });

  it("ウィザード入力が空なら作業中でない（会社名/テーマとも空白）", () => {
    expect(hasWorkInProgress(0, [], { companyInfo: { companyName: "  " } })).toBe(false);
    expect(hasWorkInProgress(0, [], { generalBrief: { title: "" } as never })).toBe(false);
    expect(hasWorkInProgress(0, [], {})).toBe(false);
  });
});

describe("hasWizardBrief（#401 ウィザード入力の検知）", () => {
  it("会社名が入っていれば true", () => {
    expect(hasWizardBrief({ companyInfo: { companyName: "A社" } })).toBe(true);
  });
  it("発表テーマが入っていれば true", () => {
    expect(hasWizardBrief({ generalBrief: { title: "テーマ" } as never })).toBe(true);
  });
  it("両方空/未設定なら false", () => {
    expect(hasWizardBrief({ companyInfo: { companyName: "" } })).toBe(false);
    expect(hasWizardBrief({})).toBe(false);
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

  it("idle＋ウィザード入力（会社名）でも未保存＝新規作成ガードが効く（#401）", () => {
    expect(hasUnsavedChanges("idle", 0, [], { companyInfo: { companyName: "A社" } })).toBe(true);
    // 保存済み（saved）なら復元可能ゆえ未保存でない（＝確認を出さない）。
    expect(hasUnsavedChanges("saved", 0, [], { companyInfo: { companyName: "A社" } })).toBe(false);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Asset } from "../../domain/project/types";
import { MaterialsScreen } from "./MaterialsScreen";

// #547 P2-1：書き出し中は素材の追加/編集/削除をロックする（store も同 PR でガード＝ここは無言 no-op を避ける表示側・ADR-0026④）。
// pickPanelAsset は先頭素材を自動選択するので、render 直後に右パネル（編集控え）が出る前提でテストする。
const asset = (id: string): Asset => ({ assetId: id, assetType: "image", displayName: id, filePath: `assets/${id}.png` });

const setup = (phase: "idle" | "rendering") => {
  useProjectStore.setState({
    templates: sampleTemplates,
    assets: [asset("asset_001")],
    assetSrcById: { asset_001: "data:image/png;base64,x" },
    scenes: [],
    exportRun: { phase, progress: { done: 0, total: 0 }, resultPath: "", message: "", bgmWarning: "", cancelling: false },
  });
};

describe("MaterialsScreen 書き出し中は編集をロック（#547 P2-1・ADR-0026④）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("書き出し中：注意バナーを出し「素材を追加」を無効化する", () => {
    setup("rendering");
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(/書き出し中は素材の追加・編集・削除ができません/)).toBeTruthy();
    const add = screen.getByText("素材を追加").closest("label") as HTMLElement;
    expect(add.getAttribute("aria-disabled")).toBe("true");
  });

  it("書き出し中：選択素材の編集控え（名前欄・削除ボタン）を出さず、代わりに理由を示す", () => {
    setup("rendering");
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    // 右パネルは出る（自動選択）が、編集控えは隠れる＝押しても効かないボタンを残さない（無言 no-op 回避）。
    expect(screen.getByText(/書き出し中は編集できません/)).toBeTruthy();
    expect(screen.queryByLabelText("名前")).toBeNull();
    expect(screen.queryByText("この素材を削除")).toBeNull();
    // 使用場面は編集ではないので出したまま（情報は見られる）。
    expect(screen.getByText("使用場面")).toBeTruthy();
  });

  it("idle（書き出しでない）：編集控えは通常どおり出る・バナーは無い（対照）", () => {
    setup("idle");
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(/書き出し中は素材の追加・編集・削除ができません/)).toBeNull();
    expect(screen.getByLabelText("名前")).toBeTruthy();
    expect(screen.getByText("この素材を削除")).toBeTruthy();
    expect((screen.getByText("素材を追加").closest("label") as HTMLElement).getAttribute("aria-disabled")).toBe("false");
  });
});

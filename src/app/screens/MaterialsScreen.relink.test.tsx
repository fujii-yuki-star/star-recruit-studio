// @vitest-environment jsdom
//
// 見つからない素材の知らせと「ファイルを選び直す」（#347）。
//
// ⚠️ **画面の配線は domain のテストでは守れない**（#793 で踏んだ形）＝`relinkAsset` が正しくても、
// ボタンが繋がっていなければ利用者には何も起きない。ここでは**出し分けと配線**だけを見る。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useProjectStore } from "../store/projectStore";
import * as assetFsMod from "../../infrastructure/assetFs";
import * as dialogMod from "../../infrastructure/dialog";
import type { Asset } from "../../domain/project/types";
import { MaterialsScreen } from "./MaterialsScreen";

const asset = (id: string, name: string): Asset =>
  ({ assetId: id, assetType: "image", displayName: name, filePath: `assets/${id}.png` }) as Asset;

describe("MaterialsScreen 見つからない素材（#347）", () => {
  const relinkAssetByPath = vi.fn();
  const refreshMissingAssets = vi.fn();

  beforeEach(() => {
    relinkAssetByPath.mockClear();
    refreshMissingAssets.mockClear();
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(true);
    vi.spyOn(assetFsMod, "missingAssetFiles").mockResolvedValue([]);
    useProjectStore.setState({
      assets: [asset("asset_001", "オフィス外観"), asset("asset_002", "会議室")],
      scenes: [], parts: [], templates: [], assetSrcById: {},
      missingAssetIds: [], importError: null, isImporting: false,
      relinkAssetByPath, refreshMissingAssets,
    });
    useProjectStore.getState().setExportRun({ phase: "idle" });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const show = () => render(<MaterialsScreen onNavigate={vi.fn()} />);

  // ⚠️ **素材はアプリの外で動かされる**＝開くたびに確かめる（一度きりだと開きっぱなしで気づけない）。
  it("画面を開いたら調べ直す", () => {
    show();
    expect(refreshMissingAssets).toHaveBeenCalled();
  });

  it("そろっているときは何も出さない（無い問題を知らせない）", () => {
    show();
    expect(screen.queryByText(/見つかりません/)).toBeNull();
  });

  /**
   * ⚠️ **どれが見つからないのか一覧で分かる**＝案内だけだと探し回ることになる。
   *
   * ⚠️ **同じことを二度言わない**（§6・この画面の既存の流儀）＝状況はバナー、どれかは一覧の印、
   * 直し方はボタン、と役割を分ける。選んだ素材の欄にも同じ説明を出していたら `alert` が2つに
   * なった（テストが先に気づいた）。
   */
  it("見つからない素材があると、案内と一覧の印を出す（案内は1つ）", () => {
    useProjectStore.setState({ missingAssetIds: ["asset_001"] });
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("1つの素材のファイルが見つかりません");
    expect(screen.getByText("見つかりません")).toBeInTheDocument(); // 一覧の印
  });

  // 見つからないときはボタンを目立たせる（探し当てた先で「これを押せばいい」が分かる）。
  it("見つからない素材を選ぶと、直すボタンが目立つ", () => {
    useProjectStore.setState({ missingAssetIds: ["asset_001"] });
    show();
    fireEvent.click(screen.getByText("オフィス外観"));
    expect(screen.getByRole("button", { name: /ファイルを選び直す/ })).toHaveClass("btn-primary");
    fireEvent.click(screen.getByText("会議室"));
    expect(screen.getByRole("button", { name: /ファイルを選び直す/ })).toHaveClass("btn-secondary");
  });

  it("「ファイルを選び直す」で選んだファイルを、その素材へ差し替える", async () => {
    vi.spyOn(dialogMod, "showOpenAssetsDialog").mockResolvedValue(["D:/new/外観.png"]);
    show();
    fireEvent.click(screen.getByText("オフィス外観"));
    fireEvent.click(screen.getByRole("button", { name: /ファイルを選び直す/ }));
    await vi.waitFor(() => expect(relinkAssetByPath).toHaveBeenCalledWith("asset_001", "D:/new/外観.png"));
  });

  it("選ばずに閉じたら何もしない", async () => {
    vi.spyOn(dialogMod, "showOpenAssetsDialog").mockResolvedValue([]);
    show();
    fireEvent.click(screen.getByText("オフィス外観"));
    fireEvent.click(screen.getByRole("button", { name: /ファイルを選び直す/ }));
    await vi.waitFor(() => expect(dialogMod.showOpenAssetsDialog).toHaveBeenCalled());
    expect(relinkAssetByPath).not.toHaveBeenCalled();
  });

  // ⚠️ **押せない理由は指したときに出す**（§2-5＝黙って効かないボタンにしない）。
  it("書き出し中は押せず、理由が出る", () => {
    useProjectStore.getState().setExportRun({ phase: "rendering" });
    show();
    fireEvent.click(screen.getByText("オフィス外観"));
    const btn = screen.getByRole("button", { name: /ファイルを選び直す/ });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toContain("書き出し");
  });

  /**
   * ⚠️ **アプリの外（ブラウザ）には出さない**＝ネイティブの「開く」が無いので、
   * 押しても何も起きないボタンになる（§2-5＝押せるのに何も起きない、を作らない）。
   */
  it("ブラウザでは「ファイルを選び直す」を出さない", () => {
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(false);
    show();
    fireEvent.click(screen.getByText("オフィス外観"));
    expect(screen.queryByRole("button", { name: /ファイルを選び直す/ })).toBeNull();
  });
});

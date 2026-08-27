// @vitest-environment jsdom
//
// 素材を名前・タグで探す（#858）。
//
// ⚠️ **タグは付けられるのに探せなかった**（ADR-0035 の調査で判明）＝付与UI も AI 利用も
// 動いているのに、一覧の絞り込みは**種類だけ**だった。横断ライブラリ（#260）とは独立に成立する。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Asset } from "../../domain/project/types";
import { MaterialsScreen } from "./MaterialsScreen";

const asset = (id: string, name: string, tags?: string[]): Asset =>
  ({ assetId: id, assetType: "image", displayName: name, filePath: `${id}.png`, tags }) as Asset;

describe("MaterialsScreen 名前・タグで探す（#858）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      assets: [
        asset("asset_001", "オフィス外観", ["本社", "外観"]),
        asset("asset_002", "logo.png", ["ロゴ"]),
        asset("asset_003", "会議室"),
      ],
      scenes: [], parts: [], templates: [], assetSrcById: {},
    });
  });

  const names = (): string[] =>
    [...document.querySelectorAll(".action-card-title")].map((e) => e.textContent ?? "");
  const search = (): HTMLInputElement => screen.getByLabelText("名前やタグで探す") as HTMLInputElement;

  it("名前で絞れる", () => {
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    fireEvent.change(search(), { target: { value: "オフィス" } });
    expect(names()).toEqual(["オフィス外観"]);
  });

  // ⚠️ **これが無かったのが #858 の主旨**（付けられるのに探せない）。
  it("タグでも絞れる（名前に無くても当たる）", () => {
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    fireEvent.change(search(), { target: { value: "ロゴ" } });
    expect(names()).toEqual(["logo.png"]);
  });

  // ⚠️ **押して絞れる候補**＝自由入力だけだと打ち間違いで見つからない。
  it("よく使うタグを押すと絞れ、もう一度押すと戻る", () => {
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    const chip = screen.getByRole("button", { name: /^ロゴ（1）$/ });
    fireEvent.click(chip);
    expect(names()).toEqual(["logo.png"]);
    fireEvent.click(screen.getByRole("button", { name: /^ロゴ（1）$/ }));
    expect(names()).toHaveLength(3); // 全部に戻る
  });

  // ⚠️ **「元から無い」と「絞り込みで消えた」を分ける**（§2-5）＝絞り込みで0件のときに
  // 「まだありません」と出すと、**追加しに行かせてしまう**（実際には持っている）。
  it("絞り込みで0件のときは「追加してください」と言わない", () => {
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    fireEvent.change(search(), { target: { value: "存在しない言葉" } });
    expect(screen.getByText("その言葉の素材は見つかりません")).toBeInTheDocument();
    expect(screen.queryByText("この種類の素材はまだありません")).toBeNull();
  });

  it("絞り込みをやめれば全部に戻る", () => {
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    fireEvent.change(search(), { target: { value: "オフィス" } });
    fireEvent.click(screen.getByRole("button", { name: "絞り込みをやめる" }));
    expect(names()).toHaveLength(3);
  });
});

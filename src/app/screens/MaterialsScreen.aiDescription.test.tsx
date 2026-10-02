// @vitest-environment jsdom
//
// 同梱の AI が写真に付けた説明（AI解析）を、素材画面で見て直せる（ADR-0052 決定4「利用者が直せる」・12 §4b）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Asset } from "../../domain/project/types";
import { MaterialsScreen } from "./MaterialsScreen";

const photo = { assetId: "asset_001", assetType: "image", displayName: "オフィス外観", filePath: "a.png", aiDescription: "明るいオフィス" } as Asset;
const clip = { assetId: "asset_002", assetType: "video", displayName: "紹介動画", filePath: "b.mp4" } as Asset;
const logo = { assetId: "asset_003", assetType: "logo", displayName: "当社マーク", filePath: "c.png" } as Asset;

describe("MaterialsScreen AI解析の欄", () => {
  beforeEach(() => {
    useProjectStore.setState({ assets: [photo, clip, logo], scenes: [], parts: [], templates: [], assetSrcById: {} });
  });

  const open = (name: string) => fireEvent.click(screen.getAllByText(name)[0]);

  it("写真は AI が付けた説明を見せ、直すと素材に入る", () => {
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    open("オフィス外観");
    const field = screen.getByLabelText("AI解析") as HTMLTextAreaElement;
    expect(field.value).toBe("明るいオフィス");
    fireEvent.change(field, { target: { value: "若手が働くオフィス" } });
    expect(useProjectStore.getState().assets[0].aiDescription).toBe("若手が働くオフィス");
    // 直したら「利用者が書いた」になる＝AI は二度と書き換えない（空にした場合も・#1317）。
    expect(useProjectStore.getState().assets[0].aiDescriptionAuthor).toBe("user");
    fireEvent.change(field, { target: { value: "" } });
    expect(useProjectStore.getState().assets[0].aiDescriptionAuthor).toBe("user");
    expect(screen.getByText("動画案を作るときの手がかりになります。直した内容は、AIが上書きしません。")).toBeInTheDocument();
  });

  it("動画にも出す（まだ無いときは、自動で書かれることを案内する）", () => {
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    open("紹介動画");
    const field = screen.getByLabelText("AI解析") as HTMLTextAreaElement;
    expect(field.value).toBe("");
    expect(field.placeholder).toBe("取り込むと、このパソコンの中のAIが写真や動画の内容を書きます");
  });

  it("ロゴには出さない（AI が読まない素材）", () => {
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    open("当社マーク");
    expect((screen.getByLabelText("名前") as HTMLInputElement).value).toBe("当社マーク");
    expect(screen.queryByLabelText("AI解析")).toBeNull();
  });
});

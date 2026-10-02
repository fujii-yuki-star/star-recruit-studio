// @vitest-environment jsdom
//
// 同梱の AI が写真に付けた説明（AI解析）を、素材画面で見て直せる（ADR-0052 決定4「利用者が直せる」・12 §4b）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import type { Asset } from "../../domain/project/types";
import { MaterialsScreen } from "./MaterialsScreen";
import { resetAiSuggestAvailabilityForTest } from "../components/AiSuggest";
import { AI_ENGINE, setAiEngine } from "../../infrastructure/appSettings";
import { MATERIAL_AI_DESC_PLACEHOLDER_AUTO, MATERIAL_AI_DESC_PLACEHOLDER_MANUAL } from "../uiLabels";

const ai = vi.hoisted(() => ({ available: true }));
vi.mock("../../infrastructure/aiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infrastructure/aiClient")>()),
  localAiAvailable: () => Promise.resolve(ai.available),
}));

const photo = { assetId: "asset_001", assetType: "image", displayName: "オフィス外観", filePath: "a.png", aiDescription: "明るいオフィス" } as Asset;
const clip = { assetId: "asset_002", assetType: "video", displayName: "紹介動画", filePath: "b.mp4" } as Asset;
const logo = { assetId: "asset_003", assetType: "logo", displayName: "当社マーク", filePath: "c.png" } as Asset;

describe("MaterialsScreen AI解析の欄", () => {
  beforeEach(() => {
    useProjectStore.setState({ assets: [photo, clip, logo], scenes: [], parts: [], templates: [], assetSrcById: {} });
    ai.available = true;
    setAiEngine(AI_ENGINE.local);
    resetAiSuggestAvailabilityForTest();
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

  it("動画にも出す（まだ無いときは、自動で書かれることを案内する）", async () => {
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    open("紹介動画");
    const field = screen.getByLabelText("AI解析") as HTMLTextAreaElement;
    expect(field.value).toBe("");
    await waitFor(() => expect(field.placeholder).toBe(MATERIAL_AI_DESC_PLACEHOLDER_AUTO));
  });

  // ⚠️ **行われない約束を出さない**（UI/UX 監査 2026-10-02）＝読み取りは同梱の AI を選んでいるときだけ走る。
  it("同梱の AI が無いときは「AIが書きます」と言わず、自分で書く案内にする", async () => {
    ai.available = false;
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    open("紹介動画");
    const field = screen.getByLabelText("AI解析") as HTMLTextAreaElement;
    await new Promise((r) => setTimeout(r, 0));
    expect(field.placeholder).toBe(MATERIAL_AI_DESC_PLACEHOLDER_MANUAL);
  });

  it("Gemini を選んでいるときも、取り込みで AI は読まない＝自分で書く案内にする", async () => {
    setAiEngine(AI_ENGINE.gemini);
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    open("紹介動画");
    const field = screen.getByLabelText("AI解析") as HTMLTextAreaElement;
    await new Promise((r) => setTimeout(r, 0));
    expect(field.placeholder).toBe(MATERIAL_AI_DESC_PLACEHOLDER_MANUAL);
  });

  it("ロゴには出さない（AI が読まない素材）", () => {
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    open("当社マーク");
    expect((screen.getByLabelText("名前") as HTMLInputElement).value).toBe("当社マーク");
    expect(screen.queryByLabelText("AI解析")).toBeNull();
  });
});

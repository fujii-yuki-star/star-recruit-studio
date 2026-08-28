// @vitest-environment jsdom
// 会社の見た目（ブランドキット・ADR-0036・#351）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../infrastructure/brandKitFs", () => ({
  loadBrandKit: vi.fn(async () => ({})),
  saveBrandKit: vi.fn(async () => {}),
}));

import { BrandKitSection } from "./BrandKitSection";
import { useProjectStore } from "../store/projectStore";
import type { Scene } from "../../domain/project/types";

const scene = { sceneId: "scene_001" } as unknown as Scene;

beforeEach(() => {
  const meta = useProjectStore.getState().meta;
  useProjectStore.setState({
    brandKit: { fontId: "kaitou-yokoku-gothic" },
    userFonts: [],
    scenes: [scene],
    assets: [],
    // 動画側は別のフォント＝「変わるものがある」状態（そうしないと反映のボタンが出ない）。
    meta: { ...meta, videoSettings: { ...meta.videoSettings, fontId: "gen-interface-jp" } },
  } as never);
});
afterEach(() => vi.clearAllMocks());

describe("BrandKitSection", () => {
  /**
   * ⚠️ **この画面には共通の「取り消す」が無い**（α-6 出口監査 🟡30）＝`UndoRedoButtons` は
   * たたき台・公開前チェック・編集のツールバーにしか置いていない。**その場に押すものが無い**のに
   * 「「取り消す」を押してください」と言うのは、実行できない次の行動を名指しすること（§2-5）。
   */
  it("反映したら、その場で戻せる導線を出す（案内だけにしない）", async () => {
    const applyBrandKit = vi.fn(async () => ({ ok: true, error: null }));
    const undo = vi.fn();
    useProjectStore.setState({ applyBrandKit, undo } as never);
    render(<BrandKitSection />);
    fireEvent.click(screen.getByRole("button", { name: "この動画に反映する" }));
    await waitFor(() => expect(screen.getByText(/この動画に反映しました/)).toBeInTheDocument());
    // 押すものが無い案内をしない＝この画面に無い「取り消す」を名指ししない。
    expect(screen.queryByText(/「取り消す」を押してください/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(undo).toHaveBeenCalled();
  });

  /** ⚠️ できなかったときは「反映しました」と言わない（§2-5・PR #888）。 */
  it("反映できなければ理由を出し、戻す導線は出さない", async () => {
    const applyBrandKit = vi.fn(async () => ({ ok: false, error: "ロゴを取り込めませんでした。" }));
    useProjectStore.setState({ applyBrandKit, undo: vi.fn() } as never);
    render(<BrandKitSection />);
    fireEvent.click(screen.getByRole("button", { name: "この動画に反映する" }));
    await waitFor(() => expect(screen.getByText(/ロゴを取り込めませんでした/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "元に戻す" })).not.toBeInTheDocument();
  });

  /** ⚠️ 手持ちの文字の形も既定にできる（ADR-0038 決定7・α-6 出口監査 🔴1）。 */
  it("手持ちの文字の形も「いつもの文字の形」に選べる", () => {
    useProjectStore.setState({
      userFonts: [{ id: "user_font_001", fileName: "a.ttf", displayName: "会社の明朝" }],
    } as never);
    render(<BrandKitSection />);
    expect(screen.getByRole("option", { name: /会社の明朝/ })).toBeInTheDocument();
  });

  /**
   * ⚠️ **覚えているのに一覧に無い字体の受け皿**（再監査で発覚＝この差分で到達可能になった）。
   * 「外す」はキットに触らないので、既定にしていた字体を外すと一致する選択肢が消え、
   * **覚えているのに「覚えない（毎回選ぶ）」を見せる**（そのまま新しい動画へは焼き込まれる）。
   * `FontPicker` で潰した失敗と**同型**。
   */
  it("覚えている字体が一覧に無くても、覚えていないようには見せない", () => {
    useProjectStore.setState({ brandKit: { fontId: "user_font_009" }, userFonts: [] } as never);
    render(<BrandKitSection />);
    const sel = screen.getByLabelText("いつもの文字の形") as HTMLSelectElement;
    expect(sel.value).toBe("user_font_009");
    expect(screen.getByRole("option", { name: /見つかりません/ })).toBeInTheDocument();
  });

  /** ⚠️ 一覧にある字体では、その受け皿を出さない（いつも出ていたら意味が無い）。 */
  it("覚えている字体が一覧にあれば、受け皿は出さない", () => {
    useProjectStore.setState({
      brandKit: { fontId: "user_font_001" },
      userFonts: [{ id: "user_font_001", fileName: "a.ttf", displayName: "会社の明朝" }],
    } as never);
    render(<BrandKitSection />);
    expect(screen.queryByRole("option", { name: /見つかりません/ })).not.toBeInTheDocument();
  });
});

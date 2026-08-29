// @vitest-environment jsdom
// 会社の見た目（ブランドキット・ADR-0036・#351）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../infrastructure/brandKitFs", () => ({
  loadBrandKit: vi.fn(async () => ({})),
  saveBrandKit: vi.fn(async () => {}),
}));

import { BrandKitSection } from "./BrandKitSection";
import { saveBrandKit } from "../../infrastructure/brandKitFs";
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
  useProjectStore.setState({ brandKitError: null } as never);
});
afterEach(() => vi.clearAllMocks());

describe("BrandKitSection", () => {
  /**
   * ⚠️ **この画面には共通の「取り消す」が無い**（α-6 出口監査 🟡30）＝`UndoRedoButtons` は
   * たたき台・公開前チェック・編集のツールバーにしか置いていない。**その場に押すものが無い**のに
   * 「「取り消す」を押してください」と言うのは、実行できない次の行動を名指しすること（§2-5）。
   */
  it("反映したら、その場で戻せる導線を出す（案内だけにしない）", async () => {
    const applyBrandKit = vi.fn(async () => ({ ok: true, applied: true, addedLogo: false, error: null }));
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
  it("何も入らずに失敗したら理由だけ出す（戻すものが無い）", async () => {
    const applyBrandKit = vi.fn(async () => ({ ok: false, applied: false, addedLogo: false, error: "ロゴを取り込めませんでした。" }));
    useProjectStore.setState({ applyBrandKit, undo: vi.fn() } as never);
    render(<BrandKitSection />);
    fireEvent.click(screen.getByRole("button", { name: "この動画に反映する" }));
    await waitFor(() => expect(screen.getByText(/ロゴを取り込めませんでした/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "元に戻す" })).not.toBeInTheDocument();
  });

  /**
   * ⚠️ **一部だけ入ったときも戻せるようにする**（PR #902 レビュー）＝フォントは入ったが
   * ロゴの取り込みで失敗した、が起こりうる（`applyBrandKit` は `pushHistory` の**後**に取り込む）。
   * 理由だけ出して戻す導線を出さないと、**変わったまま戻せない**（§2-5）。
   */
  it("一部だけ入って失敗したときは、その旨と戻す導線を出す", async () => {
    const applyBrandKit = vi.fn(async () => ({ ok: false, applied: true, addedLogo: false, error: "ロゴを取り込めませんでした。" }));
    const undo = vi.fn();
    useProjectStore.setState({ applyBrandKit, undo } as never);
    render(<BrandKitSection />);
    fireEvent.click(screen.getByRole("button", { name: "この動画に反映する" }));
    await waitFor(() => expect(screen.getByText(/一部だけ反映されています/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(undo).toHaveBeenCalled();
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

  /**
   * ⚠️ **書けなかったら覚えた顔をしない**（α-6 出口監査 🟡23・§2-5）＝画面だけ変えて保存に失敗すると、
   * 開き直したときに黙って消えている（何を変えたか本人にも分からない）。画面を戻して理由を出す。
   */
  it("覚え直しが保存できなければ、画面を戻して理由を出す", async () => {
    vi.mocked(saveBrandKit).mockRejectedValueOnce(new Error("書けない"));
    render(<BrandKitSection />);
    fireEvent.change(screen.getByLabelText("いつもの文字の形"), { target: { value: "gen-interface-jp" } });
    expect(await screen.findByText(/保存できませんでした/)).toBeInTheDocument();
    // 覚えている内容は元のまま＝保存できていないのに変わった顔をしない。
    await waitFor(() => expect(useProjectStore.getState().brandKit.fontId).toBe("kaitou-yokoku-gothic"));
  });

  /**
   * ⚠️ **書き出し中は押す前に止める**（α-6 出口監査 🟡14）＝store 側は断るのに画面は押せてしまい、
   * store のコメント「押せないようにもしてある」が**実態と違って**いた（§2-5＝押せない理由を先に出す）。
   */
  it("書き出し中は「この動画に反映する」を押せず、理由が添えてある", () => {
    useProjectStore.getState().setExportRun({ phase: "encoding" } as never);
    render(<BrandKitSection />);
    const btn = screen.getByRole("button", { name: "この動画に反映する" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "書き出しが終わるまでお待ちください");
    useProjectStore.getState().setExportRun({ phase: "idle" });
  });

  /**
   * ⚠️ **取り消しでロゴは戻らない**（差分再監査・§2-5）＝履歴が覚えるのは `{meta,parts,scenes}` だけ
   *（ADR-0020＝assets は入れない）。「元に戻す」で全部戻るかのように見せず、**戻らないもの**を言う。
   * ⚠️ **ロゴを足しただけなら「元に戻す」は出さない**＝押しても何も戻らないボタンを置かない。
   */
  it("ロゴを足しただけのときは、戻らないことを言い「元に戻す」を出さない", async () => {
    // 動画側とキットのフォントを同じにして、変わるのはロゴだけにする。
    useProjectStore.setState({ brandKit: { fontId: "gen-interface-jp", logoLibraryAssetId: "lib_asset_001" } } as never);
    const applyBrandKit = vi.fn(async () => ({ ok: true, applied: true, addedLogo: true, error: null }));
    useProjectStore.setState({ applyBrandKit } as never);
    render(<BrandKitSection />);
    fireEvent.click(screen.getByRole("button", { name: "この動画に反映する" }));
    expect(await screen.findByText(/足したロゴは素材に残ります/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "元に戻す" })).toBeNull();
  });
});

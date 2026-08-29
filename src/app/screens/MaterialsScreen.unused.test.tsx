// @vitest-environment jsdom
//
// 使っていない素材の整理（#348）。
//
// ⚠️ **検出は既にあった**（公開前チェックの「使っていない素材」）＝足りないのは
// **一覧で見て、まとめて片づける**ところだけ。判定は同じ規則（`unusedAssetIds`）を通す。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useProjectStore } from "../store/projectStore";
import * as assetFsMod from "../../infrastructure/assetFs";
import type { Asset, Scene } from "../../domain/project/types";
import type { Template } from "../../domain/template/types";
import { MaterialsScreen } from "./MaterialsScreen";

const asset = (id: string, name: string, type: Asset["assetType"] = "image"): Asset =>
  ({ assetId: id, assetType: type, displayName: name, filePath: `assets/${id}.png` }) as Asset;

const template: Template = {
  schemaVersion: "1.0", templateId: "t1", name: "写真", category: "photo_intro",
  aspectRatio: "16:9", canvas: { width: 1920, height: 1080 }, defaults: { backgroundColor: "#fff" },
  layers: [{ id: "main", type: "slot", x: 0, y: 0, w: 1920, h: 1080, zIndex: 0 }],
} as unknown as Template;

const scene = (refs: Record<string, string>): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro", templateId: "t1",
    durationSec: 8, assetRefs: refs, character: { enabled: false, characterId: "yuko" },
    texts: {}, narration: { text: "", status: "none" }, warnings: [],
  }) as unknown as Scene;

describe("MaterialsScreen 使っていない素材（#348）", () => {
  const removeAssets = vi.fn();

  beforeEach(() => {
    removeAssets.mockClear();
    vi.spyOn(assetFsMod, "isTauri").mockReturnValue(false);
    vi.spyOn(assetFsMod, "missingAssetFiles").mockResolvedValue([]);
    useProjectStore.setState({
      assets: [asset("asset_001", "使っている写真"), asset("asset_002", "余り1"), asset("asset_003", "余り2")],
      scenes: [scene({ main: "asset_001" })],
      parts: [{ partId: "part_001", title: "本編", order: 1, sceneIds: ["scene_001"] }],
      templates: [template], assetSrcById: {}, missingAssetIds: [],
      importError: null, isImporting: false, removeAssets,
    });
    useProjectStore.getState().setExportRun({ phase: "idle" });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const show = () => render(<MaterialsScreen onNavigate={vi.fn()} />);
  const toggle = () => screen.getByRole("checkbox", { name: /どこにも置いていないものだけ/ });

  // ⚠️ **押す前に「片づけるものがあるか」が分かる**＝空振りの操作を作らない。
  it("件数を出す", () => {
    show();
    expect(screen.getByText(/どこにも置いていないものだけ（2）/)).toBeInTheDocument();
  });

  it("入れると使っていないものだけになる", () => {
    show();
    expect(screen.getByText("使っている写真")).toBeInTheDocument();
    fireEvent.click(toggle());
    expect(screen.queryByText("使っている写真")).toBeNull();
    expect(screen.getByText("余り1")).toBeInTheDocument();
    expect(screen.getByText("余り2")).toBeInTheDocument();
  });

  /**
   * ⚠️ **種類とは別の軸**＝種類のタブに5つ目として混ぜると「使っていない動画だけ」が見られない。
   * 掛け合わせられることを固定する。
   */
  it("種類の絞り込みと掛け合わせられる", () => {
    useProjectStore.setState({
      assets: [asset("asset_001", "使っている写真"), asset("asset_002", "余りの写真"), asset("asset_003", "余りの動画", "video")],
    });
    show();
    fireEvent.click(toggle());
    fireEvent.click(within(screen.getByRole("group", { name: "素材の種類" })).getByRole("button", { name: "動画" }));
    expect(screen.getByText("余りの動画")).toBeInTheDocument();
    expect(screen.queryByText("余りの写真")).toBeNull();
  });

  // ⚠️ **取り消せない**（`assets` は履歴の外＝ADR-0028）ので確認を挟む（#383 と同じ流儀）。
  it("まとめて消すは確認を挟み、件数と名前を先に出す", () => {
    show();
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: /いま出ている2つをまとめて消す/ }));
    expect(removeAssets).not.toHaveBeenCalled(); // まだ消えない
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("2つの素材を削除します");
    expect(notice).toHaveTextContent("余り1、余り2");
    expect(notice).toHaveTextContent("元に戻せません");
    fireEvent.click(screen.getByRole("button", { name: /削除する/ }));
    expect(removeAssets).toHaveBeenCalledWith(["asset_002", "asset_003"]);
  });

  it("やめれば消えない", () => {
    show();
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: /まとめて消す/ }));
    fireEvent.click(screen.getByRole("button", { name: "やめる" }));
    expect(removeAssets).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * ⚠️ **消えるのは「いま見えているもの」だけ**（§2-5）＝絞り込みで隠れているものまで消えると、
   * 押した本人にも何が消えたか分からない。
   */
  it("さらに言葉で絞ったら、見えているものだけが対象になる", () => {
    show();
    fireEvent.click(toggle());
    fireEvent.change(screen.getByRole("searchbox", { name: "名前やタグで探す" }), { target: { value: "余り1" } });
    fireEvent.click(screen.getByRole("button", { name: /いま出ている1つをまとめて消す/ }));
    fireEvent.click(screen.getByRole("button", { name: /削除する/ }));
    expect(removeAssets).toHaveBeenCalledWith(["asset_002"]);
  });

  /**
   * ⚠️ **候補のタグは絞り込んだ後から集める**（#858 の規則を #348 の軸にも効かせる）＝
   * 押しても0件になる候補を出さない。使っているものにしか付いていないタグは、
   * 「使っていないものだけ」にしたら候補から消える。
   */
  it("押しても0件になるタグ候補を出さない", () => {
    useProjectStore.setState({
      assets: [
        { ...asset("asset_001", "使っている写真"), tags: ["本社"] } as Asset,
        { ...asset("asset_002", "余り1"), tags: ["下書き"] } as Asset,
      ],
    });
    show();
    // ⚠️ **候補の行だけを見る**＝選んだ素材の欄にも同じ名前のタグのボタンがある
    //（画面全体から探すと「欄の側を掴んで」候補の出来を確かめられない＝#772 で踏んだ形）。
    const chips = () => {
      const label = screen.queryByText("よく使うタグ：");
      return label ? within(label.parentElement as HTMLElement).queryAllByRole("button").map((b) => b.textContent ?? "") : [];
    };
    expect(chips().some((t) => t.includes("本社"))).toBe(true);
    fireEvent.click(toggle());
    expect(chips().some((t) => t.includes("本社"))).toBe(false); // 使っているものにしか無い
    expect(chips().some((t) => t.includes("下書き"))).toBe(true);
  });

  // ⚠️ **これは良い知らせ**＝「まだありません」だと、片づけに来た人を追加しに行かせてしまう。
  it("全部使えているときは「使っていない素材はありません」と言う", () => {
    useProjectStore.setState({ assets: [asset("asset_001", "使っている写真")] });
    show();
    fireEvent.click(toggle());
    expect(screen.getByText("どこにも置いていない素材はありません")).toBeInTheDocument();
    expect(screen.queryByText(/まだありません/)).toBeNull();
    expect(screen.queryByRole("button", { name: /まとめて消す/ })).toBeNull(); // 空振りのボタンを出さない
  });

  /**
   * ⚠️ **休眠も「置いてある」と数える**（レビュー 🟡・`11 §5`）＝差し込み先の層を失った割当は
   * **見た目を戻せば再び描かれる**。消すと戻らない（`assets` は履歴の外）ので安全側へ倒す。
   */
  it("差し込み先の層を失った素材は「どこにも置いていない」に出さない", () => {
    useProjectStore.setState({
      // `nowhere` 層はテンプレに無い＝休眠。動画には出ないが、見た目を戻せば出てくる。
      scenes: [scene({ main: "asset_001", nowhere: "asset_002" })],
    });
    show();
    expect(screen.getByText(/どこにも置いていないものだけ（1）/)).toBeInTheDocument();
    fireEvent.click(toggle());
    expect(screen.queryByText("余り1")).toBeNull(); // 休眠は消させない
    expect(screen.getByText("余り2")).toBeInTheDocument();
  });

  /**
   * ⚠️ **確認の中身は「押した瞬間のもの」**（レビュー 🔴）＝生きている一覧から名前を作ると、
   * 確認を出したまま絞り込みを変えたときに**見せている名前と実際に消えるもの**がずれる。
   * ここでは**絞り込みを変えたら確認を閉じる**ことで、ずれた確認が残らないことを固定する。
   */
  it("確認を出したあとに絞り込みを変えたら、確認は閉じる", () => {
    show();
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: /まとめて消す/ }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "名前やタグで探す" }), { target: { value: "余り1" } });
    expect(screen.queryByRole("alert")).toBeNull(); // 出しっぱなしにしない
    expect(removeAssets).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ **「絞り込みをやめる」も絞り込みの変更**（PR #875 レビュー 🟡）＝ここだけ確認を閉じておらず、
   * 「絞り込みを変えたら確認を閉じる」という**このPRが徹底したはずの規則から1か所だけ漏れて**いた。
   * 消える中身は正しいまま（控えた id を使う）だが、**一覧は全件に戻るのに確認だけ古い件数を出す**。
   *
   * ⚠️ **経路ごとにテストを持つ**＝規則を足したときに「効くべき場所を数え上げる」のを忘れると、
   * こういう1か所漏れが素通りする（このPRで3度目の同じ形）。
   */
  it("「絞り込みをやめる」でも確認は閉じる", () => {
    show();
    fireEvent.click(toggle());
    fireEvent.change(screen.getByRole("searchbox", { name: "名前やタグで探す" }), { target: { value: "余り" } });
    fireEvent.click(screen.getByRole("button", { name: /まとめて消す/ }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "絞り込みをやめる" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(removeAssets).not.toHaveBeenCalled();
  });

  it("種類のタブを変えても確認は閉じる", () => {
    show();
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole("button", { name: /まとめて消す/ }));
    fireEvent.click(within(screen.getByRole("group", { name: "素材の種類" })).getByRole("button", { name: "動画" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * ⚠️ **たたき台を作る前は出さない**（レビュー ℹ️）＝場面が無いと**全部が「どこにも置いていない」**に
   * なる。素材は **AI への入力**でもある（`12 §6`・`12 §8.3`）ので、生成のために取り込んだ一式が
   * 1押しで消える。
   */
  it("場面がまだ無いときは、まとめて消すを出さない", () => {
    useProjectStore.setState({ scenes: [], parts: [] });
    show();
    fireEvent.click(toggle());
    expect(screen.getByText("余り1")).toBeInTheDocument(); // 一覧には出る
    expect(screen.queryByRole("button", { name: /まとめて消す/ })).toBeNull(); // 消させない
  });

  it("書き出し中は押せず、理由が出る", () => {
    useProjectStore.getState().setExportRun({ phase: "rendering" });
    show();
    fireEvent.click(toggle());
    const btn = screen.getByRole("button", { name: /まとめて消す/ });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toContain("書き出し");
  });
});

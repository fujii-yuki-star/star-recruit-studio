// @vitest-environment jsdom
// よく使う素材（ユーザー素材ライブラリ・ADR-0035・#260）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("../../infrastructure/assetLibraryFs", () => ({
  listLibraryAssets: vi.fn(),
  addLibraryAsset: vi.fn(async () => ({})),
  deleteLibraryAsset: vi.fn(async () => {}),
  updateLibraryAsset: vi.fn(async () => {}),
  usedLibraryAssetIds: vi.fn(async () => []),
}));
vi.mock("../../infrastructure/dialog", () => ({ showOpenLibraryAssetsDialog: vi.fn(async () => []) }));

import { AssetLibraryPanel } from "./AssetLibraryPanel";
import { showOpenLibraryAssetsDialog } from "../../infrastructure/dialog";
import { useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";
import { addLibraryAsset, deleteLibraryAsset, listLibraryAssets, updateLibraryAsset, usedLibraryAssetIds } from "../../infrastructure/assetLibraryFs";
import { ASSET_TYPE } from "../../domain/enums";
import type { LibraryAsset } from "../../domain/asset/assetLibrary";

const lib = (over: Partial<LibraryAsset> = {}): LibraryAsset => ({
  id: "lib_asset_001",
  fileName: "lib_asset_001.png",
  displayName: "会社ロゴ",
  assetType: ASSET_TYPE.logo,
  tags: ["会社", "ロゴ"],
  ...over,
});

const importFromLibrary = vi.fn(async () => "asset_002");

beforeEach(() => {
  importFromLibrary.mockClear();
  vi.mocked(listLibraryAssets).mockResolvedValue([
    lib(),
    lib({ id: "lib_asset_002", displayName: "オフィス写真", assetType: ASSET_TYPE.image, tags: ["会社", "写真"] }),
    lib({ id: "lib_asset_003", displayName: "社員インタビュー", assetType: ASSET_TYPE.video, tags: ["採用"] }),
  ]);
  // 取り込みは**入れる先がある**ときだけ押せる（動画を開いていない画面では押せない）ので、
  // 既定では場面形式の動画を開いた状態にしておく（開いていない場合は個別のテストで作る）。
  useProjectStore.setState({ isImporting: false, importFromLibrary, brandKit: {}, updateBrandKit: vi.fn(async () => true), meta: { projectId: "proj_20260101_001", projectName: "採用2026" } } as never);
});
afterEach(() => vi.clearAllMocks());

describe("AssetLibraryPanel", () => {
  /** ⚠️ §2-3＝実装用語を画面に出さない。 */
  it("「アセット」「マニフェスト」「グローバル」を画面に出さない", async () => {
    const { container } = render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    expect(container.textContent).not.toMatch(/アセット|マニフェスト|グローバル|lib_asset/);
  });

  it("置いてある素材を並べる（タグも見せる）", async () => {
    render(<AssetLibraryPanel />);
    expect(await screen.findByText(/会社ロゴ/)).toBeInTheDocument();
    expect(screen.getByText(/（会社・ロゴ）/)).toBeInTheDocument();
  });

  /** ⚠️ **タグは「すべて含む」で絞る**（AND）＝選ぶほど狭まる。 */
  it("タグを選ぶと絞り込む（重ねるほど狭まる）", async () => {
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getByRole("button", { name: "会社" }));
    expect(screen.queryByText("社員インタビュー")).not.toBeInTheDocument();
    // ⚠️ 種類のタブにも「写真」があるので、タグの側（`aria-pressed` を持つ）を選ぶ。
    fireEvent.click(screen.getAllByRole("button", { name: "写真" }).find((b) => b.hasAttribute("aria-pressed"))!);
    expect(screen.queryByText("会社ロゴ")).not.toBeInTheDocument();
    expect(screen.getByText("オフィス写真")).toBeInTheDocument();
  });

  it("名前でも絞り込む", async () => {
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.change(screen.getByLabelText("よく使う素材を名前やタグで探す"), { target: { value: "オフィス" } });
    expect(screen.queryByText("会社ロゴ")).not.toBeInTheDocument();
    expect(screen.getByText("オフィス写真")).toBeInTheDocument();
  });

  /** ⚠️ **絞り込みで0件のときは「無い」と言わない**＝条件を外せば見えることを伝える（§2-5）。 */
  it("絞り込みで0件のときは、条件を変えるよう案内する", async () => {
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.change(screen.getByLabelText("よく使う素材を名前やタグで探す"), { target: { value: "存在しない" } });
    expect(screen.getByText(/条件に合う素材がありません/)).toBeInTheDocument();
    expect(screen.queryByText(/まだ何も置いていません/)).not.toBeInTheDocument();
  });

  it("何も置いていなければ次の行動を出す", async () => {
    vi.mocked(listLibraryAssets).mockResolvedValue([]);
    render(<AssetLibraryPanel />);
    expect(await screen.findByText(/まだ何も置いていません/)).toBeInTheDocument();
  });

  it("「この動画で使う」でコピーし、どこに増えたかまで知らせる", async () => {
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getAllByRole("button", { name: "この動画で使う" })[0]);
    await waitFor(() => expect(importFromLibrary).toHaveBeenCalledWith("lib_asset_001"));
    expect(await screen.findByText(/素材の一覧に増えています/)).toBeInTheDocument();
  });

  it("取り込めなかったときは「増えた」と言わない", async () => {
    importFromLibrary.mockResolvedValueOnce(null as never);
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getAllByRole("button", { name: "この動画で使う" })[0]);
    await waitFor(() => expect(importFromLibrary).toHaveBeenCalled());
    expect(screen.queryByText(/素材の一覧に増えています/)).not.toBeInTheDocument();
  });

  /** ⚠️ **取り込み済みの動画は影響を受けない**ことを伝える（コピーだから＝不安を残さない）。 */
  it("外すと、取り込み済みの動画はそのまま使えることを伝える", async () => {
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getAllByRole("button", { name: "外す" })[0]);
    // ⚠️ **確認を通す**（🟡27）＝1クリックでは消えない。確認の中の「外す」を押す。
    fireEvent.click(within(await screen.findByRole("alert")).getByRole("button", { name: "外す" }));
    await waitFor(() => expect(deleteLibraryAsset).toHaveBeenCalledWith("lib_asset_001"));
    // 説明文にも同じ言い回しがあるので、**外した素材の名前つき**の知らせで照合する。
    expect(await screen.findByText(/「会社ロゴ」を置き場から外しました/)).toBeInTheDocument();
  });

  /**
   * ⚠️ **会社の見た目が消した素材を指したままにしない**（#351・PR #888 レビュー 🟡）＝
   * 指し続けると、新しい動画を作るたびに「ロゴを取り込めませんでした」になる（直す道が分かりにくい）。
   */
  it("会社の見た目のロゴを外すと、そちらの覚えも外して知らせる", async () => {
    const updateBrandKit = vi.fn(async () => true);
    useProjectStore.setState({ brandKit: { logoLibraryAssetId: "lib_asset_001" }, updateBrandKit } as never);
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getAllByRole("button", { name: "外す" })[0]);
    // ⚠️ **確認を通す**（🟡27）＝1クリックでは消えない。確認の中の「外す」を押す。
    fireEvent.click(within(await screen.findByRole("alert")).getByRole("button", { name: "外す" }));
    await waitFor(() => expect(updateBrandKit).toHaveBeenCalledWith({ logoLibraryAssetId: undefined }));
    expect(await screen.findByText(/会社の見た目のロゴも外しました/)).toBeInTheDocument();
  });

  it("会社の見た目が指していない素材なら、そちらは触らない", async () => {
    const updateBrandKit = vi.fn(async () => {});
    useProjectStore.setState({ brandKit: { logoLibraryAssetId: "lib_asset_009" }, updateBrandKit } as never);
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getAllByRole("button", { name: "外す" })[0]);
    // ⚠️ **確認を通す**（🟡27）＝1クリックでは消えない。確認の中の「外す」を押す。
    fireEvent.click(within(await screen.findByRole("alert")).getByRole("button", { name: "外す" }));
    await waitFor(() => expect(deleteLibraryAsset).toHaveBeenCalled());
    expect(updateBrandKit).not.toHaveBeenCalled();
  });

  it("名前とタグを直せる（区切りは読点・カンマ・空白）", async () => {
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getAllByRole("button", { name: "名前・種類・タグ" })[0]);
    fireEvent.change(screen.getByLabelText(/タグ（読点/), { target: { value: "会社、ロゴ 新しい,タグ" } });
    fireEvent.click(screen.getByRole("button", { name: "直す" }));
    await waitFor(() =>
      expect(updateLibraryAsset).toHaveBeenCalledWith("lib_asset_001", "会社ロゴ", ["会社", "ロゴ", "新しい", "タグ"], ASSET_TYPE.logo),
    );
  });

  it("取り込み中は押せない（二重に走らせない）", async () => {
    useProjectStore.setState({ isImporting: true } as never);
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    expect(screen.getAllByRole("button", { name: "この動画で使う" })[0]).toBeDisabled();
  });

  /**
   * ⚠️ **外した番号を使い回さない**（α-6 出口監査 🟡8）＝一覧は**実体があるものだけ**なので、
   * 最大番号を外したあとに一覧から採ると同じ番号が再発行され、別の素材を指してしまう。
   */
  it("置くときの番号は「これまでに使った番号」から採る（外した番号を使い回さない）", async () => {
    vi.mocked(usedLibraryAssetIds).mockResolvedValue(["lib_asset_001", "lib_asset_007"]);
    vi.mocked(showOpenLibraryAssetsDialog).mockResolvedValue(["C:/tmp/new.png"]);
    render(<AssetLibraryPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /素材を置く/ }));
    await waitFor(() => expect(vi.mocked(addLibraryAsset)).toHaveBeenCalled());
    expect(vi.mocked(addLibraryAsset).mock.calls[0]?.[0]).toBe("lib_asset_008");
  });

  /**
   * ⚠️ **採番の口が失敗したら置かない**（PR #904 レビュー）＝`[]` として続けると番号が 001 から
   * 採り直しになり、**直したばかりの「番号の使い回し」が別経路で再現する**。理由を出して断る（§2-5）。
   */
  it("これまでの番号を取れなかったら、置かずに理由を出す", async () => {
    vi.mocked(usedLibraryAssetIds).mockRejectedValueOnce("一覧を読めませんでした。");
    vi.mocked(showOpenLibraryAssetsDialog).mockResolvedValue(["C:/a.png"]);
    render(<AssetLibraryPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /素材を置く/ }));
    expect(await screen.findByText(/一覧を読めませんでした/)).toBeInTheDocument();
    expect(vi.mocked(addLibraryAsset)).not.toHaveBeenCalled();
  });

  /**
   * ⚠️ **書き出し中は押す前に止める**（α-6 出口監査 🟡15）＝すぐ隣の「素材を追加」は押す前に
   * 無効化＋理由なのに、ここだけ押せて**画面上部のバナー**で断っていた（同じ「取り込み」で
   * 断り方が2通り＝ADR-0026②）。
   */
  it("書き出し中は押せず、理由が添えてある", async () => {
    useProjectStore.getState().setExportRun({ phase: "encoding" } as never);
    render(<AssetLibraryPanel />);
    const btn = (await screen.findAllByRole("button", { name: /この動画で使う/ }))[0];
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "書き出しが終わるまでお待ちください");
    expect(screen.getByRole("button", { name: /素材を置く/ })).toBeDisabled();
    useProjectStore.getState().setExportRun({ phase: "idle" });
  });

  /**
   * ⚠️ **途中で失敗しても、置けたぶんは残して数える**（α-6 出口監査 🟡16・§2-5）＝
   * 「全部失敗した」と読めると、もう一度押して**二重に置く**。
   */
  it("まとめて置いて一部が失敗しても、置けた件数を知らせる", async () => {
    vi.mocked(showOpenLibraryAssetsDialog).mockResolvedValue(["C:/a.png", "C:/b.png", "C:/c.png"]);
    vi.mocked(addLibraryAsset).mockReset();
    vi.mocked(addLibraryAsset)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce("だめでした")
      .mockResolvedValueOnce({} as never);
    render(<AssetLibraryPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /素材を置く/ }));
    expect(await screen.findByText(/2件を置きました/)).toBeInTheDocument();
    // 1件だけ失敗したときは理由をそのまま出す（件数で案内を変えない＝ADR-0026②）。
    expect(screen.getByText(/だめでした/)).toBeInTheDocument();
  });

  /** ⚠️ **2件以上失敗したときは件数と名前で示す**（PR #905 レビュー・`importPartlyFailedMessage` と同じ形）。 */
  it("まとめて置いて複数件が失敗したら、件数と名前を出す", async () => {
    vi.mocked(showOpenLibraryAssetsDialog).mockResolvedValue(["C:/a.png", "C:/b.png", "C:/c.png"]);
    vi.mocked(addLibraryAsset).mockReset();
    vi.mocked(addLibraryAsset)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce("だめでした")
      .mockRejectedValueOnce("だめでした");
    render(<AssetLibraryPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /素材を置く/ }));
    expect(await screen.findByText(/2件を置けませんでした（b\.png、c\.png）/)).toBeInTheDocument();
    expect(screen.getByText(/1件を置きました/)).toBeInTheDocument();
  });

  /**
   * ⚠️ **どこに増えたかは種類で変わる**（α-6 出口監査 🟡29）＝音（BGM・読み上げ）は**素材の一覧に出ない**
   *（`isListedMaterial`）ので、「素材の一覧に増えています」と言うと**案内どおり探しても見つからない**（§2-5）。
   */
  it("音を取り込んだときは、素材の一覧ではなくBGMの導線を案内する", async () => {
    vi.mocked(listLibraryAssets).mockResolvedValue([
      lib({ id: "lib_asset_004", displayName: "会社のテーマ", assetType: ASSET_TYPE.bgm, tags: [] }),
    ]);
    render(<AssetLibraryPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "この動画で使う" }));
    expect(await screen.findByText(/BGMから選べます/)).toBeInTheDocument();
    expect(screen.queryByText(/素材の一覧に増えています/)).toBeNull();
  });

  /**
   * ⚠️ **覚え直しの失敗を握りつぶさない**（差分再監査・§2-5）＝`updateBrandKit` は投げずに `false` を
   * 返して画面を巻き戻すので、戻り値を捨てると**キットは消した素材を指したまま「外しました」**になり、
   * 新しい動画を作るたびにロゴの取り込みが失敗する（PR #888 で潰した失敗に戻る）。
   */
  it("会社の見た目のロゴを外せなかったら、そう言う", async () => {
    const updateBrandKit = vi.fn(async () => false);
    useProjectStore.setState({ brandKit: { logoLibraryAssetId: "lib_asset_001" }, updateBrandKit } as never);
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getAllByRole("button", { name: "外す" })[0]);
    fireEvent.click(within(await screen.findByRole("alert")).getByRole("button", { name: "外す" }));
    expect(await screen.findByText(/会社の見た目のロゴを外せませんでした/)).toBeInTheDocument();
    expect(screen.queryByText(/会社の見た目のロゴも外しました/)).toBeNull();
  });

  /**
   * ⚠️ **ロゴは置いたあとに選ぶしかない**（差分再監査）＝拡張子では写真と区別できないので
   * `detectAssetType` は必ず `image` を返す。ここで選べないと **ADR-0036 の「いつものロゴ」が
   * どこからも設定できない**（会社の見た目の選択欄が常に空になる＝§2-5 の行き止まり）。
   */
  it("置いた素材の種類を「ロゴ」に直せる", async () => {
    render(<AssetLibraryPanel />);
    await screen.findByText("オフィス写真");
    fireEvent.click(screen.getAllByRole("button", { name: "名前・種類・タグ" })[1]); // オフィス写真
    fireEvent.change(screen.getByLabelText("種類"), { target: { value: ASSET_TYPE.logo } });
    fireEvent.click(screen.getByRole("button", { name: "直す" }));
    await waitFor(() =>
      expect(updateLibraryAsset).toHaveBeenCalledWith("lib_asset_002", "オフィス写真", ["会社", "写真"], ASSET_TYPE.logo),
    );
  });

  /**
   * ⚠️ **塞がずに名指しで解く**（差分再監査 4巡目 🔴）＝両形式は同時に開いたままにでき、**閉じる
   * 導線が無い**。タイムラインが載っているだけで取り込みを塞ぐと、一度開いた**セッション中ずっと**
   * 取り込めなくなる（しかも理由は事実と違う）＝解除できない行き止まり（§2-5）。
   * **どの動画へ入ったか**は知らせの名前で解く。
   */
  it("取り込み先の動画を名指しする", async () => {
    const meta = useProjectStore.getState().meta;
    useProjectStore.setState({ meta: { ...meta, projectName: "会社紹介" } } as never);
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getAllByRole("button", { name: "この動画で使う" })[0]);
    expect(await screen.findByText(/「会社紹介」へ取り込みました/)).toBeInTheDocument();
  });

  /**
   * ⚠️ **できたときだけ知らせる**（PR #913 レビュー 🔴）＝返り値を見ないと、失敗しても
   * 「取り込みました」と出て、画面下の本当の理由と**同時に**並ぶ（成功を騙る）。
   */
  it("タイムラインへ取り込めなかったら「取り込みました」と言わない", async () => {
    const importFromLibraryT = vi.fn(async () => false);
    useTimelineStore.setState({
      doc: { projectId: "proj_t", projectName: "タイムライン動画", clips: [], tracks: [], assets: [] },
      importFromLibrary: importFromLibraryT,
      isImporting: false,
      exportRun: { phase: "idle" },
    } as never);
    render(<AssetLibraryPanel target="timeline" />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getAllByRole("button", { name: "この動画で使う" })[0]);
    await waitFor(() => expect(importFromLibraryT).toHaveBeenCalled());
    expect(screen.queryByText(/取り込みました/)).toBeNull();
  });

  // ⚠️ **入れる先が無いときは押せない**（差分再監査 5巡目 🟡）＝「素材」は動画を開いていなくても
  // 開ける画面なので、押せると**画面に出ていない空の動画**が作られてそこへ入る（どこにも見えない）。
  it("動画を開いていないときは取り込めず、理由を出す", async () => {
    useProjectStore.setState({ meta: { projectId: "", projectName: "" }, scenes: [], status: "idle" } as never);
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    const btn = screen.getAllByRole("button", { name: "この動画で使う" })[0];
    expect(btn).toBeDisabled();
    expect(btn.title).toContain("先に動画を開いてください");
  });

  it("タイムラインの欄では、タイムラインの動画が開いていれば押せる（場面形式は関係ない）", async () => {
    useProjectStore.setState({ meta: { projectId: "", projectName: "" }, scenes: [], status: "idle" } as never);
    useTimelineStore.setState({
      doc: { projectId: "proj_t", projectName: "タイムライン動画", clips: [], tracks: [], assets: [] },
      importFromLibrary: vi.fn(async () => true), isImporting: false, exportRun: { phase: "idle" },
    } as never);
    render(<AssetLibraryPanel target="timeline" />);
    await screen.findByText("会社ロゴ");
    expect(screen.getAllByRole("button", { name: "この動画で使う" })[0]).not.toBeDisabled();
  });

  // ⚠️ **押せないのに理由が出ない、を作らない**（差分再監査 6巡目 ℹ️）＝棚の操作中（置く・直す・外す）は
  // `working` に数えるのに理由を持っておらず、4つのボタンが無言で押せなくなっていた。
  it("棚の操作中は、その理由を添える", async () => {
    vi.mocked(showOpenLibraryAssetsDialog).mockImplementation(() => new Promise(() => {})); // 開いたまま返さない
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getByRole("button", { name: "素材を置く" }));
    await waitFor(() => {
      const btn = screen.getAllByRole("button", { name: "この動画で使う" })[0];
      expect(btn).toBeDisabled();
      expect(btn.title).toContain("いまよく使う素材を操作しています");
    });
  });

  // ⚠️ **白紙から作った直後は「開いている」**（差分再監査 6巡目 🟡）＝番号（`projectId`）だけで見ると
  // 開いていないことにされ、しかも一覧に無いので**案内どおりに開き直せない**（嘘の理由＋行き止まり）。
  it("白紙から作った直後（番号なし・場面なし）でも取り込める", async () => {
    useProjectStore.setState({ meta: { projectId: "", projectName: "" }, scenes: [], status: "ready" } as never);
    render(<AssetLibraryPanel />);
    await screen.findByText("会社ロゴ");
    expect(screen.getAllByRole("button", { name: "この動画で使う" })[0]).not.toBeDisabled();
  });

  it("タイムラインの動画を開いていないときは、タイムラインの欄でも取り込めない（双子）", async () => {
    useTimelineStore.setState({ doc: null, importFromLibrary: vi.fn(async () => true), isImporting: false, exportRun: { phase: "idle" } } as never);
    render(<AssetLibraryPanel target="timeline" />);
    await screen.findByText("会社ロゴ");
    const btn = screen.getAllByRole("button", { name: "この動画で使う" })[0];
    expect(btn).toBeDisabled();
    expect(btn.title).toContain("先に動画を開いてください");
  });

  // ⚠️ **判定材料は行き先の側から採る**（PR #913 レビュー）＝場面形式の状態を見ると、
  // タイムラインが取り込み中・書き出し中でも押せて、中で静かに弾かれる。
  it("タイムラインが取り込み中・書き出し中のときは、タイムラインの欄が押せない", async () => {
    const doc = { projectId: "proj_t", projectName: "タイムライン動画", clips: [], tracks: [], assets: [] };
    useTimelineStore.setState({ doc, importFromLibrary: vi.fn(async () => true), isImporting: true, exportRun: { phase: "idle" } } as never);
    const { unmount } = render(<AssetLibraryPanel target="timeline" />);
    await screen.findByText("会社ロゴ");
    expect(screen.getAllByRole("button", { name: "この動画で使う" })[0]).toBeDisabled();
    unmount();
    useTimelineStore.setState({ doc, importFromLibrary: vi.fn(async () => true), isImporting: false, exportRun: { phase: "encoding" } } as never);
    render(<AssetLibraryPanel target="timeline" />);
    await screen.findByText("会社ロゴ");
    const btn = screen.getAllByRole("button", { name: "この動画で使う" })[0];
    expect(btn).toBeDisabled();
    expect(btn.title).toContain("書き出しが終わるまで");
  });

  // ⚠️ **どの欄から置けるかは種類で変わる**（差分再監査 5巡目 🟡）＝音は「素材・文字・図形を置く」の
  // 候補に出ないので、種類を見ずに1文で言うと案内どおり探しても見つからない。
  it("タイムラインへ音を取り込んだときは「音を置く」を案内する", async () => {
    useTimelineStore.setState({
      doc: { projectId: "proj_t", projectName: "タイムライン動画", clips: [], tracks: [], assets: [] },
      importFromLibrary: vi.fn(async () => true), isImporting: false, exportRun: { phase: "idle" },
    } as never);
    vi.mocked(listLibraryAssets).mockResolvedValue([
      lib({ id: "lib_asset_004", displayName: "会社のテーマ", assetType: ASSET_TYPE.bgm, tags: [] }),
    ]);
    render(<AssetLibraryPanel target="timeline" />);
    fireEvent.click(await screen.findByRole("button", { name: "この動画で使う" }));
    expect(await screen.findByText(/「音を置く」から置けます/)).toBeInTheDocument();
    expect(screen.queryByText(/素材・文字・図形を置く/)).toBeNull();
  });

  it("タイムラインへ取り込めたら、その動画を名指しで知らせる", async () => {
    useTimelineStore.setState({
      doc: { projectId: "proj_t", projectName: "タイムライン動画", clips: [], tracks: [], assets: [] },
      importFromLibrary: vi.fn(async () => true),
      isImporting: false,
    } as never);
    render(<AssetLibraryPanel target="timeline" />);
    await screen.findByText("会社ロゴ");
    fireEvent.click(screen.getAllByRole("button", { name: "この動画で使う" })[0]);
    expect(await screen.findByText(/「タイムライン動画」へ取り込みました/)).toBeInTheDocument();
  });
});

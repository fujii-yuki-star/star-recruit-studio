// @vitest-environment jsdom
// 会社の見た目（ブランドキット・ADR-0036・#351）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../infrastructure/brandKitFs", () => ({
  loadBrandKit: vi.fn(async () => ({})),
  saveBrandKit: vi.fn(async () => {}),
}));

import { BrandKitSection } from "./BrandKitSection";
import { loadBrandKit, saveBrandKit } from "../../infrastructure/brandKitFs";
import { useProjectStore } from "../store/projectStore";
import { useTimelineStore } from "../store/timelineStore";
import type { Scene } from "../../domain/project/types";

const scene = { sceneId: "scene_001" } as unknown as Scene;

/**
 * 本物の実装（差し替えたテストの後で戻すため）。
 *
 * ⚠️ **戻さないと次のテストが偽物を使う**＝このファイルは `applyBrandKit`/`undo` を `vi.fn` で
 * 差し替えるテストがあるのに、`beforeEach` が戻していなかった。**押した結果を見るテストが
 * 別のテストの戻り値で判定される**（実際に落ちた＝`addedLogo:true` が返ってきた）。
 * `vi.clearAllMocks()` は呼び出し履歴を消すだけで、**store へ差し込んだ関数は戻さない**。
 */
const realActions = {
  applyBrandKit: useProjectStore.getState().applyBrandKit,
  undo: useProjectStore.getState().undo,
};

beforeEach(() => {
  useProjectStore.setState(realActions as never);
  const meta = useProjectStore.getState().meta;
  useProjectStore.setState({
    brandKit: { fontId: "kaitou-yokoku-gothic" },
    userFonts: [],
    scenes: [scene],
    assets: [],
    // 動画側は別のフォント＝「変わるものがある」状態（そうしないと反映のボタンが出ない）。
    meta: { ...meta, videoSettings: { ...meta.videoSettings, fontId: "gen-interface-jp" } },
  } as never);
  useProjectStore.setState({ brandKitError: null, brandKitUnreadable: false } as never);
  // ⚠️ **書き出しの状態を持ち越さない**＝「書き出し中は押せない」のテストが `encoding` を立てたままなので、
  // 以降のテストでボタンが**押せないまま**になり、押した結果を見るテストが**別の理由で落ちる**（実際に落ちた）。
  useProjectStore.getState().setExportRun({ phase: "idle" });
  useTimelineStore.setState({ doc: null } as never);
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
    // ⚠️ **読み直しが終わってから触る**（差分再監査 ℹ️ の是正）＝この画面は表示時に
    // `refreshBrandKit` を走らせるので、待たずに変えると**戻し先が読み直しの結果に上書きされる**
    // タイミングに依存する（以前は「戻すときに丸ごと戻す」実装がその上書きを消していて緑だった）。
    vi.mocked(loadBrandKit).mockResolvedValue({ fontId: "kaitou-yokoku-gothic" });
    vi.mocked(saveBrandKit).mockRejectedValueOnce(new Error("書けない"));
    render(<BrandKitSection />);
    await waitFor(() => expect(useProjectStore.getState().brandKit.fontId).toBe("kaitou-yokoku-gothic"));
    fireEvent.change(screen.getByLabelText("いつもの文字の形"), { target: { value: "gen-interface-jp" } });
    expect(await screen.findByText(/保存できませんでした/)).toBeInTheDocument();
    // 覚えている内容は元のまま＝保存できていないのに変わった顔をしない。
    await waitFor(() => expect(useProjectStore.getState().brandKit.fontId).toBe("kaitou-yokoku-gothic"));
  });

  // ⚠️ **戻すのは「自分が書いた値がまだ載っているとき」だけ**（差分再監査 ℹ️）＝丸ごと戻すと、
  // 保存を待つ間に入った**次の変更まで巻き添えで巻き戻る**（ディスクは後勝ちなので食い違う）。
  it("保存を待つ間に入った次の変更は、巻き戻さない", async () => {
    vi.mocked(loadBrandKit).mockResolvedValue({ fontId: "kaitou-yokoku-gothic" });
    let reject: (e: Error) => void = () => {};
    vi.mocked(saveBrandKit).mockImplementationOnce(() => new Promise((_, rj) => { reject = rj; }));
    render(<BrandKitSection />);
    await waitFor(() => expect(useProjectStore.getState().brandKit.fontId).toBe("kaitou-yokoku-gothic"));

    const first = useProjectStore.getState().updateBrandKit({ fontId: "gen-interface-jp" });
    // 先の保存が着地する前に、次の変更が入る（こちらは成功する）。
    await useProjectStore.getState().updateBrandKit({ fontId: "gen-interface-jp-display" });
    reject(new Error("書けない"));
    await first;

    expect(useProjectStore.getState().brandKit.fontId).toBe("gen-interface-jp-display");
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

  /**
   * ⚠️ **塞がずに名指しで解く**（差分再監査 4巡目 🔴）＝両形式は同時に開いたままにでき、**閉じる
   * 導線が無い**。タイムラインが載っているだけで反映を塞ぐと、一度開いた**セッション中ずっと**
   * 場面形式の動画にも反映できなくなる（解除できない行き止まり・§2-5）。
   * どちらの文書の話かは**反映先の名前**で解く。
   */
  it("両方開いていても、場面形式の動画へは名指しで反映できる", () => {
    const meta = useProjectStore.getState().meta;
    useProjectStore.setState({ meta: { ...meta, projectId: "proj_20260830_0001", projectName: "会社紹介" } } as never);
    useTimelineStore.setState({ doc: { projectId: "proj_t", clips: [], tracks: [] } } as never);
    render(<BrandKitSection />);
    expect(screen.getByText(/「会社紹介」に反映する/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "この動画に反映する" })).toBeInTheDocument();
  });

  /**
   * ⚠️ **タイムラインだけ開いているときに「開いていません」と言わない**（嘘の理由・§2-5）。
   */
  it("タイムラインだけ開いているときは、その旨を言う", () => {
    const meta = useProjectStore.getState().meta;
    // ⚠️ **「開いていない」の条件を明示する**（差分再監査 7巡目 🟡）＝`status` を書かないと、
    // 暗黙の初期値に依っていることが読み取れない（判定は `hasOpenProject` の4条件）。
    useProjectStore.setState({ meta: { ...meta, projectId: "", projectName: "", companyInfo: undefined }, scenes: [], status: "idle" } as never);
    useTimelineStore.setState({ doc: { projectId: "proj_t", clips: [], tracks: [] } } as never);
    render(<BrandKitSection />);
    expect(screen.getByText(/タイムラインで作った動画には、ここからは反映できません/)).toBeInTheDocument();
    expect(screen.queryByText(/いまは動画を開いていません/)).toBeNull();
  });

  // ⚠️ **白紙から作った直後も「開いている」**（差分再監査 6巡目 🟡・判定は `hasOpenProject`）＝
  // 番号だけで見ると「開いていません」と言い、その動画は一覧に無いので開き直せない。
  it("白紙から作った直後（番号なし・場面なし）でも、反映先として名指しする", () => {
    const meta = useProjectStore.getState().meta;
    useProjectStore.setState({ meta: { ...meta, projectId: "", projectName: "会社紹介" }, scenes: [], status: "ready" } as never);
    useTimelineStore.setState({ doc: null } as never);
    render(<BrandKitSection />);
    expect(screen.getByText(/「会社紹介」に反映する/)).toBeInTheDocument();
    expect(screen.queryByText(/いまは動画を開いていません/)).toBeNull();
  });

  // ⚠️ **読めていないことを言う**（`/canon-check` 🟡・§2-5）＝黙っていると**空のキット**
  //（「覚えない」・色0件・ロゴ無し）を見せる。兄弟の欄（よく使う素材・文字の形）は同じ状況で
  // 「読めませんでした」と言うので、ここだけ黙ると**同じ状況で違うことを言う**（ADR-0026②）。
  it("会社の見た目を読めていないときは、その旨を出す（空のキットに見せない）", () => {
    useProjectStore.setState({ brandKit: {}, brandKitUnreadable: true } as never);
    render(<BrandKitSection />);
    expect(screen.getByText(/会社の見た目を読めませんでした/)).toBeInTheDocument();
    expect(screen.getByText(/いまは変更できません/)).toBeInTheDocument();
  });

  // ⚠️ **行き止まりを作らない**（差分再監査 🟡・§2-5）＝上書きを断る門を下ろせるのは読み込みの成功
  // だけなので、ファイルが本当に壊れていると**二度と変えられない**。押したときだけ通る出口を置く。
  it("読めないときは、作り直す出口がある（何が失われるかを先に言う）", async () => {
    useProjectStore.setState({ brandKit: {}, brandKitUnreadable: true } as never);
    render(<BrandKitSection />);
    fireEvent.click(screen.getByRole("button", { name: "直らないときは作り直す" }));
    expect(screen.getByText(/作り直すと空になります/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "作り直す" }));
    await waitFor(() => expect(useProjectStore.getState().brandKitUnreadable).toBe(false));
    expect(saveBrandKit).toHaveBeenCalledWith({});
  });

  // ⚠️ **読めていないときに「同じです」と言わない**（§2-5）＝読めていないだけで、
  // **同じだと確かめたわけではない**（嘘の安心を出さない）。
  it("読めないときは「同じです」ではなく「反映できません」と言う", () => {
    useProjectStore.setState({ brandKit: {}, brandKitUnreadable: true } as never);
    render(<BrandKitSection />);
    expect(screen.getByText(/いまは反映できません/)).toBeInTheDocument();
    expect(screen.queryByText(/覚えている見た目と同じです/)).toBeNull();
    expect(screen.queryByRole("button", { name: /この動画に反映する/ })).toBeNull();
  });

  it("押す前に確認する（押した瞬間に消さない）", () => {
    useProjectStore.setState({ brandKit: {}, brandKitUnreadable: true } as never);
    render(<BrandKitSection />);
    fireEvent.click(screen.getByRole("button", { name: "直らないときは作り直す" }));
    expect(saveBrandKit).not.toHaveBeenCalled();
  });

  it("読めているときは出さない（毎回出すと意味が薄れる）", () => {
    useProjectStore.setState({ brandKit: {}, brandKitUnreadable: false } as never);
    render(<BrandKitSection />);
    expect(screen.queryByText(/会社の見た目を読めませんでした/)).toBeNull();
  });

  // ⚠️ **入らなかったものがあれば言う**（#929・§2-5）＝黙ると「ロゴだけ入ったのに反映しました」
  // ＝失敗を成功に見せることになる。
  it("覚えている字体が手元に無いときは、入らなかったことを言う", async () => {
    vi.mocked(loadBrandKit).mockResolvedValue({ fontId: "user_font_999_gone" } as never);
    useProjectStore.setState({ brandKit: { fontId: "user_font_999_gone" }, brandKitUnreadable: false } as never);
    render(<BrandKitSection />);
    // ⚠️ **読み直しが終わってから押す**＝この画面は表示時に `refreshBrandKit` を走らせるので、
    // 待たずに押すと**読み直し前のキット**（`beforeEach` が入れた既知の字体）で反映が通り、
    // テストが**時々通って時々落ちる**（実際に落ちた）。
    await waitFor(() => expect(useProjectStore.getState().brandKit.fontId).toBe("user_font_999_gone"));
    fireEvent.click(screen.getByRole("button", { name: /この動画に反映する/ }));
    expect(await screen.findByText(/いまこのパソコンにありません/)).toBeInTheDocument();
    expect(screen.queryByText(/^この動画に反映しました。$/)).toBeNull();
  });
});

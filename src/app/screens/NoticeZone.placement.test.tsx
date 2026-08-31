// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NOTICE_ZONE_CLASS } from "../components/NoticeZone";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { ProjectHeader } from "../../domain/project/persistence";
import type { Asset, Scene } from "../../domain/project/types";
import { HomeScreen } from "./HomeScreen";
import { MaterialsScreen } from "./MaterialsScreen";

// #940：画面ぜんぶに効く知らせ・確認は**画面の先頭**に出るのに、それを起こす操作は**一覧の下の方**にある。
// 一覧を下まで送って押すと確認が視野の外に出て、そのあいだ一覧は押せなくなる＝利用者からは
// 「一覧が固まった」だけに見える（§2-5）。`06 §2` 統一規約9（#774）と同じ型で、同じ手（貼り付ける）で直す。
//
// ⚠️ **出ることだけ見ても足りない**＝置き場所そのものが要件。`getByText` で確認の文が取れても、
// それが `.main-scroll` の中を一緒に流れていくなら、押した人には見えていない。

/**
 * スクロールしても消えないか（`EditorToolbar.placement.test.tsx` と**同じ物差し**）。
 * 満たし方は2通りで、どちらでも結果は同じ＝**スクロールする側の外に居る**か、**貼り付けてある**か。
 */
const staysVisibleOnScroll = (el: Element): boolean =>
  el.closest(".main-scroll") == null || el.closest(`.${NOTICE_ZONE_CLASS}`) != null;

/** 差し替える前の本物（`afterEach` で戻す）。 */
const realRefreshMissingAssets = useProjectStore.getState().refreshMissingAssets;

const ONE = [{ projectId: "proj_001", projectName: "テスト動画", updatedAt: "2026-07-09T00:00:00Z" }];

/** 書き出しの状態（`ExportLockBanner` の出し分け）。**毎回この形へ戻す**＝下の 🟡 参照。 */
const exportRun = (phase: "idle" | "rendering") => ({
  phase, progress: { done: 0, total: 0 }, resultPath: "", message: "",
  bgmWarning: "", duckMerged: false, cancelling: false, resultUnseen: false,
});

/**
 * 未保存の変更がある状態（`scenes.length > 0` ＋ `saveStatus:"idle"`）＝カードを押すと確認が挟まる。
 * ⚠️ **`exportRun` も毎回置く**（レビュー 🟡）＝素材の検査が「書き出し中」にするので、置かないと
 * **前のテストの書き出し中が持ち越されて** `ExportLockBanner` が居座る（テストの順番で結果が変わる）。
 */
function setupHome(over: Partial<Parameters<typeof useProjectStore.setState>[0]> = {}) {
  useProjectStore.setState({
    listProjects: vi.fn(() => Promise.resolve(ONE as unknown as ProjectHeader[])),
    loadProject: vi.fn(() => Promise.resolve()),
    saveStatus: "idle",
    scenes: [{ sceneId: "scene_001" } as unknown as Scene],
    assets: [],
    importError: null,
    missingAssetIds: [],
    exportRun: exportRun("idle"),
    ...over,
  } as never);
}

const asset = (id: string): Asset => ({ assetId: id, assetType: "image", displayName: id, filePath: `assets/${id}.png` });

/** 素材画面を書き出し中にする＝一覧の行の操作（消す・直す）が断りの文を立てる状態。 */
function setupMaterials(over: Partial<Parameters<typeof useProjectStore.setState>[0]> = {}) {
  useProjectStore.setState({
    templates: sampleTemplates,
    assets: [asset("asset_001")],
    assetSrcById: { asset_001: "data:image/png;base64,x" },
    scenes: [],
    status: "ready",
    importError: null,
    missingAssetIds: [],
    // ⚠️ **調べ直しを止める**＝素材画面は開いた直後に「見つからない素材」を調べ直すので、
    // 置いた値がその場で消える（`MaterialsScreen.relink.test.tsx` と同じ手）。**元に戻す**のは `afterEach`。
    refreshMissingAssets: vi.fn(),
    exportRun: exportRun("rendering"),
    ...over,
  } as never);
}

describe("画面ぜんぶに効く知らせは、スクロールしても消えない（#940）", () => {
  // ⚠️ **毎回まっさらから始める**（レビュー 🟡）＝この束は同じ store を共有し、宣言順に走る。
  // 素材の検査が「書き出し中」にするので、戻さないと**次の検査に書き出し中が持ち越される**。
  beforeEach(() => useProjectStore.setState({ importError: null, missingAssetIds: [], exportRun: exportRun("idle") } as never));
  // ⚠️ **差し替えた store の関数を元へ戻す**＝戻さないと、あとのテストが**前のテストの偽物**で判定する。
  afterEach(() => {
    useProjectStore.setState({ refreshMissingAssets: realRefreshMissingAssets } as never);
    vi.restoreAllMocks();
  });

  it("動画の一覧：カードを押して出た確認が、下まで送っても消えない", async () => {
    setupHome();
    render(<HomeScreen onNavigate={vi.fn()} />);
    fireEvent.click((await screen.findByText("テスト動画")).closest("button") as HTMLButtonElement);
    const confirmText = screen.getByText(/別のプロジェクトを開きますか/);
    expect(staysVisibleOnScroll(confirmText)).toBe(true);
    // 答える手段（やめる／開く）も一緒に見えていること＝文だけ見えても行き止まり（§2-5）。
    expect(staysVisibleOnScroll(screen.getByRole("button", { name: "やめる" }))).toBe(true);
    expect(staysVisibleOnScroll(screen.getByRole("button", { name: "開く" }))).toBe(true);
  });

  it("動画の一覧：出ている知らせが**ひとつ残らず**消えない", async () => {
    setupHome();
    render(<HomeScreen onNavigate={vi.fn()} />);
    fireEvent.click((await screen.findByText("テスト動画")).closest("button") as HTMLButtonElement);
    const alerts = screen.getAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
    // ⚠️ **この状態で出るものしか見えない**＝出す条件が違う知らせ（開けなかった・消せなかった・
    // 名前を変えられなかった）は、ここでは描かれないので通り抜ける。囲いの外へ新しく足したときに
    // 気づけるよう、**同じ入れ物にまとめてある**ことを下の「入れ物の中に在る」で別途固定する。
    for (const a of alerts) expect(staysVisibleOnScroll(a)).toBe(true);
  });

  it("動画の一覧：知らせは1つの入れ物にまとまっている（外へ足したら気づける）", async () => {
    setupHome();
    const { container } = render(<HomeScreen onNavigate={vi.fn()} />);
    fireEvent.click((await screen.findByText("テスト動画")).closest("button") as HTMLButtonElement);
    const zone = container.querySelector(`.${NOTICE_ZONE_CLASS}`);
    expect(zone).not.toBeNull();
    for (const a of screen.getAllByRole("alert")) expect(zone?.contains(a)).toBe(true);
  });

  // ⚠️ **6つの分岐を全部立てる**（レビュー 🟡）＝ひとつ（確認）だけ見ていると、**残りを囲いの外へ
  // 出しても緑のまま**通り抜ける。出す条件が分岐ごとに違うので、実際にその状態を作ってから見る。
  describe("動画の一覧：先頭に出る知らせは、どの種類でも囲いの中にある", () => {
    const inZone = (el: Element) => el.closest(`.${NOTICE_ZONE_CLASS}`) != null;

    it("新しく作る確認（未保存があるとき）", async () => {
      setupHome();
      render(<HomeScreen onNavigate={vi.fn()} />);
      fireEvent.click(screen.getAllByRole("button", { name: "新しい動画を作る" })[0]);
      expect(inZone(await screen.findByText(/新しく作りますか/))).toBe(true);
    });

    it("開けなかったとき", async () => {
      // 保存済み＝確認を挟まずそのまま開きにいく（そこで失敗させる）。
      setupHome({ saveStatus: "saved", loadProject: vi.fn(() => Promise.reject(new Error("x"))) } as never);
      render(<HomeScreen onNavigate={vi.fn()} />);
      fireEvent.click((await screen.findByText("テスト動画")).closest("button") as HTMLButtonElement);
      expect(inZone(await screen.findByText(/開けませんでした|正しくありません/))).toBe(true);
    });

    it("消せなかったとき", async () => {
      setupHome({ saveStatus: "saved", deleteProject: vi.fn(() => Promise.reject(new Error("x"))) } as never);
      render(<HomeScreen onNavigate={vi.fn()} />);
      await screen.findByText("テスト動画");
      fireEvent.click(screen.getByRole("button", { name: "「テスト動画」を削除" }));
      fireEvent.click(await screen.findByRole("button", { name: "削除する" }));
      expect(inZone(await screen.findByText(/削除できませんでした/))).toBe(true);
    });

    it("名前を変えられなかったとき", async () => {
      setupHome({ saveStatus: "saved", renameProject: vi.fn(() => Promise.reject(new Error("x"))) } as never);
      render(<HomeScreen onNavigate={vi.fn()} />);
      await screen.findByText("テスト動画");
      fireEvent.click(screen.getByRole("button", { name: "「テスト動画」の名前を変更" }));
      const input = await screen.findByLabelText("プロジェクト名");
      fireEvent.change(input, { target: { value: "べつの名前" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(inZone(await screen.findByText(/名前を変更できませんでした/))).toBe(true);
    });

    it("書き出し中の案内", async () => {
      setupHome({ saveStatus: "saved", exportRun: exportRun("rendering") } as never);
      render(<HomeScreen onNavigate={vi.fn()} />);
      // 書き出し中の案内は `role="status"`（alert ではない）＝alert だけ見ていると素通りする。
      expect(inZone(screen.getByRole("status"))).toBe(true);
    });
  });

  // ⚠️ 素材も同じ＝3つの分岐すべてを立てる（レビュー 🟡）。
  describe("素材：先頭に出る知らせは、どの種類でも囲いの中にある", () => {
    const inZone = (el: Element) => el.closest(`.${NOTICE_ZONE_CLASS}`) != null;

    it("素材のファイルが見つからないとき", () => {
      setupMaterials({ missingAssetIds: ["asset_001"], exportRun: exportRun("idle") } as never);
      render(<MaterialsScreen onNavigate={vi.fn()} />);
      expect(inZone(screen.getByText(/素材のファイルが見つかりません/))).toBe(true);
    });

    it("書き出し中の案内", () => {
      setupMaterials();
      render(<MaterialsScreen onNavigate={vi.fn()} />);
      expect(inZone(screen.getByRole("status"))).toBe(true);
    });
  });

  it("素材：一覧の行の操作が立てた断りが、下まで送っても消えない", () => {
    setupMaterials();
    render(<MaterialsScreen onNavigate={vi.fn()} />);
    // 一覧の行の操作（消す）＝画面のずっと下でも起こりうる。断りは画面の先頭に出る。
    act(() => useProjectStore.getState().removeAssets(["asset_001"]));
    const notice = screen.getByText(/書き出しが終わるまで、素材の追加や変更はできません/);
    expect(staysVisibleOnScroll(notice)).toBe(true);
  });

  // ⚠️ **知らせが1つも無いときは、入れ物が空である**（レビュー ℹ️）＝下地を伸ばす指定は
  // `:not(:empty)` で条件を付けてあるので、React が falsy の子を DOM に作らないことが前提になる。
  // ここが崩れると（例：入れ物が常に何か描くようになると）**画面の先頭に帯が出しっぱなし**になる。
  it("知らせが1つも無いとき、入れ物は空（先頭に帯を出さない）", async () => {
    setupHome();
    const { container } = render(<HomeScreen onNavigate={vi.fn()} />);
    await screen.findByText("テスト動画"); // 一覧が出るまで待つ（この時点で知らせは無い）
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    const zone = container.querySelector(`.${NOTICE_ZONE_CLASS}`) as HTMLElement;
    expect(zone).not.toBeNull();
    expect(zone.childNodes).toHaveLength(0);
  });

  // ⚠️ **物差しが効いていることを確かめる**＝何にでも真を返すなら、上の検査は何も見ていないのと同じ。
  // スクロールする側の中に居て貼り付いていないもの（＝まさに流れていく一覧のカード）では偽になる。
  it("スクロールする側の中で貼り付いていないものは「消えない」と見なさない（物差しの自己検査）", async () => {
    setupHome();
    render(<HomeScreen onNavigate={vi.fn()} />);
    const card = (await screen.findByText("テスト動画")).closest("button") as HTMLButtonElement;
    expect(staysVisibleOnScroll(card)).toBe(false);
  });

  // ⚠️ **印が本当に「貼り付ける」意味を持つか**まで見る＝この検査が無いと、クラスを付けただけ
  //（見た目は何も変わらない）でも上のテストが通ってしまう（#774 のテストと同じ理由）。
  it("貼り付けの印は、実際に貼り付ける指定を持つ", () => {
    const css = readFileSync("src/styles/theme.css", "utf-8"); // 走らせる場所はリポジトリの根
    // `String.raw` で書く＝ふつうの文字列だと `\.`/`\s` が**黙って `.`/`s` に落ちて**、
    // 「規則が見つからない」でしか気づけない（正規表現の意味が変わったことは型でも lint でも出ない）。
    const rule = css.match(new RegExp(String.raw`\.${NOTICE_ZONE_CLASS}\s*\{[^}]*\}`));
    expect(rule).not.toBeNull();
    expect(rule?.[0]).toMatch(/position:\s*sticky/);
    expect(rule?.[0]).toMatch(/top:\s*0/);
  });
});

// @vitest-environment jsdom
// 差し込み口の素材・見た目パターンを「見て選ぶ」（#1031）。
//
// ⚠️ 以前はどちらも**名前の一覧**で、選んでみるまで何になるか分からなかった（試し打ち）。
// ⚠️ **選べない候補も一覧から消さない**＝いま選ばれているものが消えると、何が選ばれているのか
//    読めない空欄になる（#415 P2 の挙動をそのまま引き継ぐ）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Asset, Scene } from "../../domain/project/types";
import type { SceneEditFocus } from "../data/mockData";
import { PICKER_MISSING_LABEL, PICKER_NOTE } from "../uiLabels";
import { SceneEditScreen } from "./SceneEditScreen";

/** 主役の差し込み口を持つ見た目。 */
const withSlot = sampleTemplates.find((t) => t.layers.some((l) => l.id === "mainVisual"))!;
/** ロゴの口を持つ見た目（入れられる素材の規則が他と違うので別に取る）。 */
const withLogo = sampleTemplates.find((t) => t.layers.some((l) => l.type === "logo"))!;

const scene = (over: Partial<Scene> = {}, tmpl = withSlot): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: tmpl.category,
    templateId: tmpl.templateId, durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: { title: "見出し" },
    narration: { text: "", status: "none" }, warnings: [], ...over,
  } as unknown as Scene);

const photo = (id: string, name: string): Asset =>
  ({ assetId: id, assetType: "image", displayName: name, filePath: `C:/${id}.png`, tags: [] } as unknown as Asset);

const setup = (opts: {
  scenes?: Scene[]; templates?: typeof sampleTemplates; assets?: Asset[]; focus?: SceneEditFocus;
} = {}) => {
  const scenes = opts.scenes ?? [scene()];
  const assets = opts.assets ?? [];
  useProjectStore.setState({
    templates: opts.templates ?? sampleTemplates,
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: scenes.map((s) => s.sceneId) }],
    scenes, assets,
    assetSrcById: Object.fromEntries(assets.map((a) => [a.assetId, `data:image/png;base64,${a.assetId}`])),
    editingSceneId: scenes[0]?.sceneId ?? null,
    editingSceneFocus: opts.focus ?? null,
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
  return render(<SceneEditScreen onNavigate={vi.fn()} />);
};

/**
 * 見出しの文言から、それが指している欄を引く。
 *
 * ⚠️ **`htmlFor` をたどって引く**＝見出しと欄が結ばれていること自体もここで確かめる（#1075）。
 */
const fieldOf = (container: HTMLElement, labelText: string): HTMLElement => {
  const label = [...container.querySelectorAll("label")].find((l) => l.textContent === labelText);
  expect(label, `見出し「${labelText}」が無い`).toBeTruthy();
  const el = container.querySelector(`#${CSS.escape(label!.htmlFor)}`);
  expect(el, `見出し「${labelText}」が欄と結ばれていない`).toBeTruthy();
  return el as HTMLElement;
};

/** 開いた格子のタイル（候補）。呼び名（`aria-label`）で見分ける。 */
const tiles = (container: HTMLElement): HTMLButtonElement[] =>
  [...container.querySelectorAll("[aria-expanded='true']")]
    .flatMap((btn) => [...(btn.parentElement?.querySelectorAll("button[aria-label]") ?? [])]) as HTMLButtonElement[];

/** 呼び名が一致するタイル。 */
const tile = (container: HTMLElement, name: string): HTMLButtonElement | undefined =>
  tiles(container).find((b) => b.getAttribute("aria-label") === name);

describe("差し込み口の素材を見て選ぶ（#1031）", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectStore.setState({ past: [], future: [], _historyGroupDepth: 0 });
  });

  it("押すと、候補が絵つきで並ぶ", () => {
    const { container } = setup({ assets: [photo("asset_001", "会社の外観")], focus: "assets" });
    fireEvent.click(fieldOf(container, "メイン素材"));
    const t = tile(container, "会社の外観");
    expect(t, "候補に素材が出ていない").toBeTruthy();
    expect(t!.querySelector("img")?.getAttribute("src"), "候補が名前だけで絵が無い")
      .toBe("data:image/png;base64,asset_001");
  });

  // ⚠️ **描いていないことを直に見る**＝「開いているピッカーの中のタイル」を数える形だと、
  // 畳んでいても描き続ける壊し方を**捕まえられない**（変異チェックで生き残った）。
  it("押すまでは候補を描かない（開くまで要らない仕事をしない）", () => {
    const { container } = setup({ assets: [photo("asset_001", "会社の外観")], focus: "assets" });
    // この欄の中だけを数える（左の素材一覧にも同じ絵が出ている）。
    const drawn = () => fieldOf(container, "メイン素材").parentElement!.querySelectorAll("img").length;
    expect(drawn(), "畳んでいるのに候補の絵を描いている").toBe(0);
    fireEvent.click(fieldOf(container, "メイン素材"));
    expect(drawn(), "開いても候補の絵が無い").toBeGreaterThan(0);
  });

  it("候補を選ぶと、その素材が差し込み口に入る", () => {
    const { container } = setup({ assets: [photo("asset_001", "会社の外観")], focus: "assets" });
    fireEvent.click(fieldOf(container, "メイン素材"));
    fireEvent.click(tile(container, "会社の外観")!);
    expect(useProjectStore.getState().scenes[0]!.assetRefs.mainVisual).toBe("asset_001");
  });

  it("「なし」を選ぶと外れる", () => {
    const { container } = setup({
      scenes: [scene({ assetRefs: { mainVisual: "asset_001" } } as Partial<Scene>)],
      assets: [photo("asset_001", "会社の外観")], focus: "assets",
    });
    fireEvent.click(fieldOf(container, "メイン素材"));
    fireEvent.click(tile(container, "なし")!);
    expect(useProjectStore.getState().scenes[0]!.assetRefs.mainVisual).toBeNull();
  });

  // ⚠️ 素材を消しても `assetRefs` は残る（`removeAssets` は場面を触らない）ので、
  //    候補に無い id を指した状態になりうる。名前の `<select>` だった頃は
  //    **先頭（「なし」）が選ばれて見え**、入っていないと言いながら実際は消えた素材を指していた。
  it("消した素材を指したままの差し込み口を「なし」と言わない", () => {
    const { container } = setup({
      scenes: [scene({ assetRefs: { mainVisual: "asset_gone" } } as Partial<Scene>)],
      assets: [photo("asset_001", "会社の外観")], focus: "assets",
    });
    const shown = fieldOf(container, "メイン素材").textContent ?? "";
    expect(shown, "入っているのに「なし」と見えている").toBe(PICKER_MISSING_LABEL.asset);
    expect(shown, "内部の綴りを画面に出している").not.toContain("asset_gone");
    // 見た目のピッカーと同じ形＝一覧にも選べない候補として残る。
    fireEvent.click(fieldOf(container, "メイン素材"));
    const gone = tile(container, PICKER_MISSING_LABEL.asset);
    expect(gone, "一覧からも消えている").toBeTruthy();
    expect(gone!.disabled, "見つからない素材が選べてしまう").toBe(true);
  });

  // ⚠️ **入れられない種類が入っているときは言い分ける**＝同じ「候補に無い」でも、
  //    取り込み直すのか別の口へ移すのかで次の行動が違う。
  it("この口には入れられない素材が入っているときは、その理由を出す", () => {
    const video = { assetId: "asset_009", assetType: "video", displayName: "会社紹介の映像", filePath: "C:/v.mp4", tags: [] } as unknown as Asset;
    const { container } = setup({
      scenes: [scene({ assetRefs: { logo: "asset_009" } } as Partial<Scene>, withLogo)],
      assets: [video], focus: "assets",
    });
    fireEvent.click(fieldOf(container, "ロゴ"));
    const bad = tiles(container).find((b) => b.getAttribute("aria-label")?.startsWith("会社紹介の映像"));
    expect(bad, "入っている素材が一覧から消えている").toBeTruthy();
    expect(bad!.getAttribute("aria-label"), "入れられない理由が出ていない").toContain(PICKER_NOTE.assetNotAssignable);
    expect(bad!.disabled, "入れられない素材が選べてしまう").toBe(true);
  });

  // ⚠️ 名前だけの一覧（`<select>`）は同じ値を選び直しても何も起きなかったが、
  //    格子は「いま選ばれているタイル」も押せる（PR #1085 レビュー）。
  it("同じ素材を選び直しても、取り消せるものは積まらない", () => {
    const { container } = setup({
      scenes: [scene({ assetRefs: { mainVisual: "asset_001" } } as Partial<Scene>)],
      assets: [photo("asset_001", "会社の外観")], focus: "assets",
    });
    const before = useProjectStore.getState().past.length;
    fireEvent.click(fieldOf(container, "メイン素材"));
    fireEvent.click(tile(container, "会社の外観")!);
    expect(useProjectStore.getState().past.length, "中身は同じなのに取り消せるものが増えている").toBe(before);
    expect(useProjectStore.getState().scenes[0]!.assetRefs.mainVisual, "中身が変わっている").toBe("asset_001");
  });

  it("入れられない素材は候補に出さない（ロゴの口に動画は入らない）", () => {
    const video = { assetId: "asset_009", assetType: "video", displayName: "会社紹介の映像", filePath: "C:/v.mp4", tags: [] } as unknown as Asset;
    const { container } = setup({ scenes: [scene({}, withLogo)], assets: [video], focus: "assets" });
    fireEvent.click(fieldOf(container, "ロゴ"));
    expect(tiles(container).length, "候補が一つも開いていない").toBeGreaterThan(0);
    expect(tile(container, "会社紹介の映像"), "ロゴの口に動画が出ている").toBeUndefined();
  });
});

describe("見た目パターンを見て選ぶ（#1031）", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectStore.setState({ past: [], future: [], _historyGroupDepth: 0 });
  });

  it("押すと、候補が見本の絵つきで並ぶ", () => {
    const { container } = setup({ focus: "look" });
    fireEvent.click(fieldOf(container, "見た目パターン"));
    const list = tiles(container);
    expect(list.length, "候補が並んでいない").toBeGreaterThan(0);
    for (const t of list) {
      expect(t.querySelector("svg"), `候補「${t.textContent}」が名前だけで見本が無い`).toBeTruthy();
    }
  });

  // ⚠️ 上と同じ理由で**見本の中身**を直に見る（例文は `buildSampleScene` だけが出す）。
  it("押すまでは見本を描かない（見た目の数だけ描き直さない）", () => {
    const { container } = setup({ focus: "look" });
    // 見本の例文は `buildSampleScene` だけが出す（場面の中身は「見出し」）。
    const samples = () =>
      (fieldOf(container, "見た目パターン").parentElement!.innerHTML.match(/見出しの例/g) ?? []).length;
    expect(samples(), "畳んでいるのに候補ぶんの見本を描いている").toBe(1);
    fireEvent.click(fieldOf(container, "見た目パターン"));
    expect(samples(), "開いても候補の見本が無い").toBeGreaterThan(1);
  });

  it("候補を選ぶと、その見た目に切り替わる", () => {
    const { container } = setup({ focus: "look" });
    fireEvent.click(fieldOf(container, "見た目パターン"));
    const other = tiles(container).find((b) => !b.getAttribute("aria-current"))!;
    const name = other.getAttribute("aria-label");
    fireEvent.click(other);
    const now = useProjectStore.getState().scenes[0]!.templateId;
    expect(sampleTemplates.find((t) => t.templateId === now)?.name, "選んだ見た目に切り替わっていない").toBe(name);
  });

  it("見つからない見た目も一覧に残る（何が選ばれているか読めなくならない）", () => {
    const { container } = setup({ scenes: [scene({ templateId: "tmpl_missing" } as Partial<Scene>)], focus: "look" });
    const trigger = fieldOf(container, "見た目パターン");
    expect(trigger.textContent, "選択中が空欄になっている").toContain("見つかりません");
    fireEvent.click(trigger);
    const gone = tiles(container).find((b) => b.getAttribute("aria-label")?.includes("見つかりません"));
    expect(gone, "見つからない見た目が一覧から消えている").toBeTruthy();
    expect(gone!.disabled, "見つからない見た目が選べてしまう").toBe(true);
  });

  it("今の動画に合わない見た目も一覧に残り、選べない", () => {
    const portrait = { ...withSlot, templateId: "tpl_portrait", name: "縦の見た目", aspectRatio: "9:16", canvas: { width: 1080, height: 1920 } };
    const { container } = setup({
      scenes: [scene({ templateId: "tpl_portrait" } as Partial<Scene>)],
      templates: [...sampleTemplates, portrait] as typeof sampleTemplates,
      focus: "look",
    });
    fireEvent.click(fieldOf(container, "見た目パターン"));
    const bad = tiles(container).find((b) => b.getAttribute("aria-label")?.startsWith("縦の見た目"));
    expect(bad, "合わない見た目が一覧から消えている").toBeTruthy();
    expect(bad!.getAttribute("aria-label"), "合わない理由が出ていない").toContain("今の動画に合いません");
    expect(bad!.disabled, "合わない見た目が選べてしまう").toBe(true);
  });
});

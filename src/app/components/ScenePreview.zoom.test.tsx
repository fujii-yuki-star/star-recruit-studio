// @vitest-environment jsdom
//
// ズームが**箱の実寸**に効いていること（#142）。
//
// ⚠️ **CSS の `transform: scale` ではなく実寸を変える**のが要点＝操作オーバーレイ
//（`FreeLayoutOverlay`）は `getBoundingClientRect()` から縮尺を導く（`scale = rect.width / canvas.width`）ので、
// **箱が実際に大きくなれば座標整合が自動で取れる**。`transform` だとレイアウトが追従せず、
// **掴んだ場所と実際の位置がずれる**（#142 のメモにある「座標整合に注意」）。
// このテストが無いと「操作部品は出るのに何も起きない」を見逃す（配線テストは部品の有無しか見ない）。
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { ScenePreview } from "./ScenePreview";

const scene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "opening",
    templateId: sampleTemplates[0].templateId, durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  }) as unknown as Scene;

/** fit 箱＝`role="img"` の親（実寸を持つ要素）。 */
const boxOf = (c: HTMLElement): HTMLElement =>
  (c.querySelector('[role="img"]') as HTMLElement).parentElement as HTMLElement;

describe("ScenePreview のズーム（#142）", () => {
  beforeEach(() => {
    useProjectStore.setState({ templates: sampleTemplates, assets: [], scenes: [scene()] });
  });

  // ⚠️ jsdom は実寸を持たない＝`fit` は計測できず `null` のまま。**フィット時は従来どおり**
  //（幅は CSS フォールバック・`maxWidth:100%`）であることだけを見る。
  it("フィットのときは中央寄せ・はみ出さない（従来の見え方を変えない）", () => {
    const { container } = render(<ScenePreview scene={scene()} template={sampleTemplates[0]} />);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.style.justifyContent).toBe("center");
    expect(outer.style.overflow).toBe("");
    expect(boxOf(container).style.maxWidth).toBe("100%");
  });

  // ⚠️ **拡大時は「はみ出してよい」**＝`maxWidth:100%` のままだと**拡大しても縮められて見た目が
  // 変わらない**（拡大の意味が消える）。外側が横スクロールで受ける。
  it("拡大したら、はみ出しを許して送れるようにする", () => {
    const { container } = render(<ScenePreview scene={scene()} template={sampleTemplates[0]} zoom={200} />);
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.style.overflow).toBe("auto");
    expect(outer.style.justifyContent).toBe("flex-start");
    expect(boxOf(container).style.maxWidth).toBe("");
  });

  // ⚠️ **`transform` を使っていない**＝使うとレイアウトが追従せず、オーバーレイの座標がずれる。
  it("箱に transform を掛けない（オーバーレイの座標整合を壊さない）", () => {
    const { container } = render(<ScenePreview scene={scene()} template={sampleTemplates[0]} zoom={200} />);
    expect(boxOf(container).style.transform).toBe("");
  });
});

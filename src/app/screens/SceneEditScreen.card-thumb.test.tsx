// @vitest-environment jsdom
// 場面カードは「見て選べる」（#1031）。
//
// ⚠️ 以前は全カードが**同じ写真の絵**で、中身は下の文字（種類・見た目の名前・セリフの先頭）でしか
//    分からなかった。⚠️ **描画の核は共有する**（`layoutScene`）＝カードで見えているものと
//    書き出されるものを食い違わせない（ADR-0001）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { SceneEditScreen } from "./SceneEditScreen";

const scene = (id: string, order: number, over: Partial<Scene> = {}): Scene =>
  ({
    sceneId: id, partId: "part_001", order, sceneType: "opening",
    templateId: sampleTemplates[0].templateId, durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: { title: `見出し${order}` },
    narration: { text: "", status: "none" }, warnings: [], ...over,
  } as unknown as Scene);

const setup = (scenes: Scene[], templates = sampleTemplates) => {
  useProjectStore.setState({
    templates,
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: scenes.map((s) => s.sceneId) }],
    scenes, assets: [], editingSceneId: scenes[0]?.sceneId ?? null,
    past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
  });
  return render(<SceneEditScreen onNavigate={vi.fn()} />);
};

/** 場面ストリップのカード（横に並ぶ選択ボタン）。 */
const cards = (container: HTMLElement): HTMLElement[] =>
  [...container.querySelectorAll(".scene-card")] as HTMLElement[];

describe("場面カードの見本（#1031）", () => {
  beforeEach(() => {
    localStorage.clear();
    useProjectStore.setState({ past: [], future: [], _historyGroupDepth: 0 });
  });

  it("カードに、その場面の見本（絵）が出る", () => {
    const { container } = setup([scene("scene_001", 1)]);
    const thumb = cards(container)[0]?.querySelector(".scene-card-thumb");
    expect(thumb, "見本の枠が無い").not.toBeNull();
    expect(thumb?.querySelector("svg"), "見本が絵になっていない").not.toBeNull();
  });

  it("場面ごとに中身が違う（同じ絵を並べない）", () => {
    const { container } = setup([
      scene("scene_001", 1, { texts: { title: "はじめまして" } } as Partial<Scene>),
      scene("scene_002", 2, { texts: { title: "さようなら" } } as Partial<Scene>),
    ]);
    const svgs = cards(container).map((c) => c.querySelector(".scene-card-thumb")?.innerHTML ?? "");
    expect(svgs).toHaveLength(2);
    expect(svgs[0], "2枚とも同じ絵になっている").not.toBe(svgs[1]);
    expect(svgs[0]).toContain("はじめまして");
    expect(svgs[1]).toContain("さようなら");
  });

  // ⚠️ **箱の形を画面に合わせる**（PR #1084 レビュー）＝CSS の既定は 16:9 なので、
  // 縦型（9:16・ADR-0012）だと**左右に大きな余白**が出る。
  it("縦型の見た目なら、箱も縦型になる", () => {
    const portrait = { ...sampleTemplates[0], templateId: "tpl_portrait", aspectRatio: "9:16", canvas: { width: 1080, height: 1920 } };
    const { container } = setup(
      [scene("scene_001", 1, { templateId: "tpl_portrait" } as Partial<Scene>)],
      [portrait as never],
    );
    const thumb = cards(container)[0]?.querySelector(".scene-card-thumb") as HTMLElement;
    expect(thumb?.style.aspectRatio, "箱が横型のまま").toBe("1080 / 1920");
  });

  it("横型の見た目なら、箱も横型のまま", () => {
    const { container } = setup([scene("scene_001", 1)]);
    const thumb = cards(container)[0]?.querySelector(".scene-card-thumb") as HTMLElement;
    expect(thumb?.style.aspectRatio).toBe("1920 / 1080");
  });

  it("見た目が引けない場面は、絵にせず写真の印を出す（存在しない見た目について語らない）", () => {
    const { container } = setup([scene("scene_001", 1, { templateId: "tmpl_missing" } as Partial<Scene>)]);
    const thumb = cards(container)[0]?.querySelector(".scene-card-thumb");
    expect(thumb, "見本の枠が無い").not.toBeNull();
    // ⚠️ 写真の印自体も `<svg>` なので、**印の印**（`thumb-photo`）で見分ける。
    expect(thumb?.classList.contains("thumb-photo"), "見た目が無いのに絵を描いている").toBe(true);
  });

  it("見た目が引ける場面は、写真の印を出さない（見本に置き換える）", () => {
    const { container } = setup([scene("scene_001", 1)]);
    const thumb = cards(container)[0]?.querySelector(".scene-card-thumb");
    expect(thumb?.classList.contains("thumb-photo"), "見本があるのに写真の印のまま").toBe(false);
  });
});

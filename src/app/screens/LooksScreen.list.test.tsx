// @vitest-environment jsdom
// 見た目パターンの一覧を「見て選ぶ」（#1031）。
//
// ⚠️ 以前は**名前＋カテゴリの文字だけ**で、絞り込みも向きの印も無かった＝選んで右に出してみるまで
//    どんな見た目か分からず、この動画で使えるのかも分からなかった。
// ⚠️ **見本は右の大きなものと同じ作り**（`buildSampleScene`）＝描画の核を共有する（ADR-0001）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Template } from "../../domain/template/types";
import { LooksScreen } from "./LooksScreen";

const portrait = {
  ...sampleTemplates[0], templateId: "tpl_portrait", name: "縦のオープニング",
  aspectRatio: "9:16", canvas: { width: 1080, height: 1920 },
} as unknown as Template;

const setup = (templates: Template[] = [...sampleTemplates, portrait], aspectRatio: "16:9" | "9:16" = "16:9") => {
  const meta = useProjectStore.getState().meta;
  useProjectStore.setState({
    templates, assets: [], scenes: [], parts: [],
    meta: { ...meta, videoSettings: { ...meta.videoSettings, aspectRatio } },
  });
  return render(<LooksScreen onNavigate={vi.fn()} />);
};

/** 一覧のカード（見た目を選ぶボタン）。 */
const cards = (container: HTMLElement): HTMLButtonElement[] =>
  [...container.querySelectorAll("button.action-card")] as HTMLButtonElement[];

/** カードの名前（`action-card-title`）。 */
const names = (container: HTMLElement): string[] =>
  cards(container).map((c) => c.querySelector(".action-card-title")?.textContent ?? "");

describe("見た目パターンの一覧（#1031）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("カードに見本（絵）が出る", () => {
    const { container } = setup();
    for (const c of cards(container)) {
      expect(c.querySelector("svg"), `「${c.querySelector(".action-card-title")?.textContent}」に見本が無い`).toBeTruthy();
    }
  });

  it("カードに向きが出る（この動画で使えるかが分かる）", () => {
    const { container } = setup();
    const card = cards(container).find((c) => c.textContent?.includes("縦のオープニング"));
    expect(card?.querySelector(".action-card-desc")?.textContent, "向きが出ていない").toContain("縦型（9:16）");
  });

  it("向きで絞れる", () => {
    const { container } = setup();
    expect(names(container), "はじめから縦型が隠れている").toContain("縦のオープニング");
    const landscape = names(container).filter((n) => n !== "縦のオープニング" && !n.includes("縦"));
    expect(landscape.length, "横型の見本が一つも無い").toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "縦型（9:16）" }));
    const shown = cards(container);
    expect(shown.length, "全部消えている").toBeGreaterThan(0);
    for (const c of shown) {
      expect(c.querySelector(".action-card-desc")?.textContent, `横型が残っている（${c.querySelector(".action-card-title")?.textContent}）`)
        .toContain("縦型（9:16）");
    }
    expect(names(container), "横型が残っている").not.toContain(landscape[0]);
  });

  it("種類で絞れる", () => {
    const { container } = setup();
    const before = names(container).length;
    fireEvent.click(screen.getByRole("button", { name: "写真紹介" }));
    const after = names(container);
    expect(after.length, "絞り込みが効いていない").toBeLessThan(before);
    expect(after.length, "全部消えている").toBeGreaterThan(0);
  });

  it("名前で探せる", () => {
    const { container } = setup();
    fireEvent.change(screen.getByLabelText("名前で探す"), { target: { value: "縦の" } });
    expect(names(container)).toEqual(["縦のオープニング"]);
  });

  // ⚠️ **行き止まりを作らない**（§2-5）＝0件のときに、戻し方が画面から分からない状態にしない。
  it("1つも当たらないときは、戻し方を出す", () => {
    const { container } = setup();
    fireEvent.change(screen.getByLabelText("名前で探す"), { target: { value: "そんな名前は無い" } });
    expect(cards(container), "当たっていないのにカードが出ている").toHaveLength(0);
    expect(container.textContent).toContain("絞り込みをやめる");
    fireEvent.click(screen.getByRole("button", { name: "絞り込みをやめる" }));
    expect(names(container).length, "戻せていない").toBeGreaterThan(0);
  });

  // ⚠️ **絞り込みは一覧の見え方だけ**＝探している途中で右の中身が入れ替わらない。
  it("絞り込んでも、選んでいる見た目は右に出たまま", () => {
    const { container } = setup();
    fireEvent.click(cards(container).find((c) => c.textContent?.includes("縦のオープニング"))!);
    fireEvent.click(screen.getByRole("button", { name: "横型（16:9）" }));
    expect(names(container), "絞り込みが効いていない").not.toContain("縦のオープニング");
    expect(screen.getByText("名前").parentElement?.textContent, "右の中身が入れ替わった").toContain("縦のオープニング");
  });

  // ⚠️ **使えない向きは印で言う**＝並べるのをやめると「作ったのに出てこない」になる。
  it("この動画で使えない向きの見た目は、その旨を出す", () => {
    const { container } = setup();
    fireEvent.click(cards(container).find((c) => c.textContent?.includes("縦のオープニング"))!);
    expect(container.textContent, "使えないことが分からない").toContain("この動画では使えません");
  });
});

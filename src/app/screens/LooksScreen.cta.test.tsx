// @vitest-environment jsdom
// 「この見た目をもとに作る」を見本の直下に出す（#1031）。
//
// ⚠️ 以前は右欄の**4本目の区切り線の下**に secondary で置いており、初回は探すことになっていた
//    （実機確認済み）。⚠️ **同じボタンを上下2か所に出さない**（どちらを押せばいいのか分からなくなる）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Template } from "../../domain/template/types";
import { DUPLICATE_LOOK_LABEL } from "../uiLabels";
import { LooksScreen } from "./LooksScreen";

/** 自分の見た目（ユーザーテンプレ）。 */
const mine = { ...sampleTemplates[0], templateId: "user_tmpl_001", name: "自分の見た目" } as unknown as Template;

const setup = (templates: Template[]) => {
  useProjectStore.setState({ templates, assets: [], scenes: [], parts: [] });
  return render(<LooksScreen onNavigate={vi.fn()} />);
};

/** 右欄（見本のカード）の中のボタン。 */
const rightPanelButtons = (container: HTMLElement): HTMLButtonElement[] => {
  const head = [...container.querySelectorAll(".section-title")].find((h) => h.textContent === "見本");
  const card = head?.closest(".card") as HTMLElement | null;
  return [...(card?.querySelectorAll("button") ?? [])] as HTMLButtonElement[];
};

/** 見本（プレビュー）より後ろにあるか。 */
const isAfterPreview = (container: HTMLElement, el: Element): boolean => {
  const preview = container.querySelector(".section-title")!;
  return !!(preview.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
};

describe("見た目をもとに作る導線（#1031）", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("標準の見た目では「もとに作る」が主な操作（primary）", () => {
    const { container } = setup([...sampleTemplates]);
    const btn = screen.getByText(DUPLICATE_LOOK_LABEL).closest("button")!;
    expect(btn.className, "主な操作になっていない").toContain("btn-primary");
    expect(isAfterPreview(container, btn), "見本より前にある").toBe(true);
  });

  // ⚠️ **見本の直下**＝ほかの節（名前・使用している要素・使用場面）より前に出す。
  // ⚠️ **「使用場面より前」だけでは緩い**（PR #1093 レビュー）＝間にある「名前」の節より
  //    下へ押し下げても通ってしまう（見本と CTA の間に別の情報が割り込む壊れ方）。
  //    **すぐ下の節**（名前）より前で見る。
  it("「もとに作る」は、ほかの節より前に出る", () => {
    const { container } = setup([...sampleTemplates]);
    const btn = screen.getByText(DUPLICATE_LOOK_LABEL).closest("button")!;
    const after = (el: Element): boolean =>
      !!(btn.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    const nameRow = [...container.querySelectorAll(".text-muted")].find((e) => e.textContent === "名前")!;
    const usedHead = [...container.querySelectorAll(".field-label")].find((h) => h.textContent === "使用場面")!;
    expect(after(nameRow), "名前の節より後ろにある（見本の直下ではない）").toBe(true);
    expect(after(usedHead), "使用場面より後ろにある").toBe(true);
  });

  // ⚠️ **同じボタンを2か所に出さない**＝上と下のどちらを押せばいいのか分からなくなる。
  it("「もとに作る」は画面に1つだけ", () => {
    setup([...sampleTemplates]);
    expect(screen.getAllByText(DUPLICATE_LOOK_LABEL)).toHaveLength(1);
  });

  it("自分の見た目では「編集する」が主な操作で、「もとに作る」は下に回る", () => {
    const { container } = setup([mine, ...sampleTemplates]);
    const edit = screen.getByText("この見た目を編集する").closest("button")!;
    const dup = screen.getByText(DUPLICATE_LOOK_LABEL).closest("button")!;
    expect(edit.className, "編集が主な操作になっていない").toContain("btn-primary");
    expect(dup.className, "もとに作るが主な操作のまま").not.toContain("btn-primary");
    expect(edit.compareDocumentPosition(dup) & Node.DOCUMENT_POSITION_FOLLOWING, "並び順が逆").toBeTruthy();
    expect(rightPanelButtons(container).length, "右欄のボタンが見つからない").toBeGreaterThan(1);
  });

  // ⚠️ **中身が空の入れ物を残さない**＝標準の見た目では「ほかの操作」に出すものが無い。
  it("標準の見た目では「ほかの操作」の節を出さない", () => {
    const { container } = setup([...sampleTemplates]);
    expect(container.textContent).not.toContain("ほかの操作");
  });

  it("自分の見た目では「ほかの操作」の節を出す（複製と削除）", () => {
    const { container } = setup([mine, ...sampleTemplates]);
    expect(container.textContent).toContain("ほかの操作");
    expect(container.textContent).toContain("この見た目パターンを削除");
  });

  // ⚠️ **標準か自分のかを言う**＝主な操作が出し分かるので、その理由も同じ場所に要る。
  it("標準の見た目には、直接は編集できない旨を添える", () => {
    const { container } = setup([...sampleTemplates]);
    expect(container.textContent).toContain("標準（直接は編集できません）");
  });
});

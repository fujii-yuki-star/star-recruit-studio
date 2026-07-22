// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { LooksEditScreen } from "./LooksEditScreen";

// #547 P2-4：テンプレ作成の「重ね順」一覧を場面編集（FREE）と揃える。
// 従来は各行が「削除」だけで、並べ替えは数値欄（重なり順）頼みだった＝同じ一覧なのに操作セットが別物（ADR-0026②）。
// あわせて、一覧の並びを**実効 z**（描画と同じ `effectiveLayerZ`）にする。`zIndex ?? 0` で並べると
// zIndex 未指定のレイヤーが全て同順とみなされ、一覧の見た目と実際の重なりが食い違う。
const userTemplate = { ...sampleTemplates[0], templateId: "user_tmpl_001", name: "マイ見た目" };

describe("LooksEditScreen 重ね順一覧の並べ替え（#547 P2-4）", () => {
  beforeEach(() => {
    useProjectStore.setState({ templates: [userTemplate, ...sampleTemplates], assets: [], editingTemplateId: "user_tmpl_001" });
  });

  /** 一覧の行順（上＝手前）。各行に付けた「〜を前面へ」ボタンの並びから読む。 */
  const rowOrder = (): string[] =>
    screen
      .getAllByRole("button", { name: /を前面へ$/ })
      .map((b) => (b.getAttribute("aria-label") ?? "").replace(/を前面へ$/, ""));

  const undoBtn = (): HTMLButtonElement => screen.getByLabelText("取り消す").closest("button") as HTMLButtonElement;

  it("並びは実効 z の降順＝描画と同じ重なり順（zIndex 未指定でも種別既定で並ぶ）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    // opening_yuko_right_v1：背景0 / 文字30 / 字幕50 / ロゴ60 / ゆうこ40 → 上（手前）から ロゴ→字幕→ゆうこ→文字→背景。
    expect(rowOrder()).toEqual(["ロゴ", "字幕", "ゆうこ", "文字（見出し）", "背景"]);
  });

  // 本命：zIndex 未指定のテンプレ。`zIndex ?? 0` で並べると全て同順とみなされ配列順に出てしまい、
  // 実際の描画（種別ごとの既定順）と食い違う。実効 z で並べていれば描画どおりに出る。
  it("zIndex 未指定のレイヤーも描画どおりの順で並ぶ（種別ごとの既定順）", () => {
    useProjectStore.setState({
      templates: [
        {
          ...sampleTemplates[0],
          templateId: "user_tmpl_002",
          name: "z未指定",
          // 配列順は「背景→文字→ロゴ」＝実効 z の降順（ロゴ60→文字30→背景0）とは逆。
          layers: [
            { id: "bg", type: "background", x: 0, y: 0, w: 1920, h: 1080 },
            { id: "txt", type: "text", textKey: "title", x: 0, y: 0, w: 400, h: 100 },
            { id: "lg", type: "logo", x: 0, y: 0, w: 200, h: 100 },
          ],
        },
        ...sampleTemplates,
      ] as typeof sampleTemplates,
      assets: [],
      editingTemplateId: "user_tmpl_002",
    });
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    expect(rowOrder()).toEqual(["ロゴ", "文字（見出し）", "背景"]); // 配列順（背景→文字→ロゴ）ではない
  });

  // 同じ z が並ぶケース（同梱テンプレに実在＝point_list の 見出し/本文 はどちらも 30）。
  // 描画は昇順・安定ソート＝**同 z は配列の後ろが手前**（本文が見出しより手前）。一覧はその反転でなければならない。
  // 単純な降順ソートだと同 z で前後が逆に出て、↑↓ が1段にならない（飛んだり、押しても動かないのに履歴だけ積まれる）。
  it("同じ z のレイヤーも描画どおりの前後で並び、↑はきっかり1段動く", () => {
    const pointList = sampleTemplates.find((t) => t.templateId === "point_list_yuko_v1")!;
    useProjectStore.setState({
      templates: [{ ...pointList, templateId: "user_tmpl_003", name: "同z" }, ...sampleTemplates] as typeof sampleTemplates,
      editingTemplateId: "user_tmpl_003",
    });
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    // 配列順は 背景→見出し(30)→本文(30)→ゆうこ→字幕。同 z は後ろが手前なので、本文が見出しより上に出る。
    expect(rowOrder()).toEqual(["字幕", "ゆうこ", "文字（本文）", "文字（見出し）", "背景"]);

    fireEvent.click(screen.getByRole("button", { name: "文字（見出し）を前面へ" }));
    // 1段だけ上がる＝本文と入れ替わる（ゆうこを飛び越さない）。
    expect(rowOrder()).toEqual(["字幕", "ゆうこ", "文字（見出し）", "文字（本文）", "背景"]);
  });

  it("↑（前面へ）で1段上がり、↓（背面へ）で戻る", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字（見出し）を前面へ" }));
    expect(rowOrder()).toEqual(["ロゴ", "字幕", "文字（見出し）", "ゆうこ", "背景"]); // ゆうこ と入れ替わって1段前へ

    fireEvent.click(screen.getByRole("button", { name: "文字（見出し）を背面へ" }));
    expect(rowOrder()).toEqual(["ロゴ", "字幕", "ゆうこ", "文字（見出し）", "背景"]); // 元へ
  });

  it("最前面をさらに前面へ／最背面をさらに背面へ は何も起きない（端）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    const before = rowOrder();
    fireEvent.click(screen.getByRole("button", { name: "ロゴを前面へ" }));
    fireEvent.click(screen.getByRole("button", { name: "背景を背面へ" }));
    expect(rowOrder()).toEqual(before);
    expect(undoBtn().disabled).toBe(true); // 変化なし＝履歴も積まない（空の取り消しを作らない）
  });

  it("並べ替えは取り消せる（#547 P2-3 の下書き履歴に乗る）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    const before = rowOrder();
    fireEvent.click(screen.getByRole("button", { name: "文字（見出し）を前面へ" }));
    expect(rowOrder()).not.toEqual(before);
    fireEvent.click(undoBtn());
    expect(rowOrder()).toEqual(before); // 1回で戻る
  });
});

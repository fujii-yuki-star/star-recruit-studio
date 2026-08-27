// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { dragEnd, dragOver, pointerDownAt } from "../../test/pointer";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { LooksEditScreen } from "./LooksEditScreen";
import { fitLabel } from "../uiLabels";

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

// #547 P2-11/P2-10：重ね順の数値欄ラベルと、収め方セレクトの文言を正典・共有語にそろえる。
describe("LooksEditScreen 重ね順・収め方の表記（#547 P2-11/P2-10）", () => {
  beforeEach(() => {
    useProjectStore.setState({ templates: [userTemplate, ...sampleTemplates], assets: [], editingTemplateId: "user_tmpl_001" });
  });

  it("選択レイヤーの数値欄は「重ね順」（「重なり順」にしない・06_UI_SPEC §3）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "背景" })); // レイヤーを選択
    expect(screen.getByText("重ね順")).toBeTruthy();
    expect(screen.queryByText("重なり順")).toBeNull();
  });

  it("スロットの収め方は共有 fitLabel の文言を出す（テンプレ編集と FitSelect で同じ語・§6）", () => {
    const withSlot = {
      ...userTemplate,
      layers: [{ id: "mainVisual", type: "slot", x: 0, y: 0, w: 100, h: 100 } as (typeof userTemplate.layers)[number]],
    };
    useProjectStore.setState({ templates: [withSlot, ...sampleTemplates] });
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "メイン素材" })); // スロットのレイヤー行を選択
    // 収め方セレクトの選択肢が共有語（枠いっぱい…）になっている。
    expect(screen.getByRole("option", { name: fitLabel.cover })).toBeTruthy();
  });
});

// #772 候補3/4：層一覧を「掴んで並べ替え」と「複製」に対応させる（帯・FREE 要素と同じ操作セットへ）。
describe("LooksEditScreen 層の掴み替えと複製（#772）", () => {
  beforeEach(() => {
    useProjectStore.setState({ templates: [userTemplate, ...sampleTemplates], assets: [], editingTemplateId: "user_tmpl_001" });
  });

  const rowOrder = (): string[] =>
    screen
      .getAllByRole("button", { name: /を前面へ$/ })
      .map((b) => (b.getAttribute("aria-label") ?? "").replace(/を前面へ$/, ""));

  // ⚠️ **画面は「上＝手前」**（描画順の反転）＝渡す位置を裏返し忘れると、上へ落としたのに背面へ行く。
  // domain（`moveToIndexByZ`）だけ緑でも、この反転を落とすと利用者には**逆に動いて見える**。
  /**
   * jsdom は実寸を持たないので、**全行に縦の帯を割り当てる**（1行 100px・上から順）。
   * ⚠️ **落とし先の行だけ差し込むと足りない**＝すき間の判定は並び全体の位置関係を見るので、
   * ほかの行が 0 サイズのままだと**幾何が潰れて 1つ手前のすき間に落ちる**（実際にそれで1段ずれた）。
   */
  const layoutRows = (rows: Element[]) => {
    rows.forEach((el, i) => {
      (el as HTMLElement).getBoundingClientRect = () =>
        ({ left: 0, top: i * 100, width: 200, height: 100, right: 200, bottom: (i + 1) * 100, x: 0, y: i * 100, toJSON: () => undefined }) as DOMRect;
    });
  };

  it("持ち手を掴んで別の位置へ落とすと、その位置へ入る（上＝手前のまま）", () => {
    const { container } = render(<LooksEditScreen onNavigate={vi.fn()} />);
    expect(rowOrder()).toEqual(["ロゴ", "字幕", "ゆうこ", "文字（見出し）", "背景"]);
    const handles = [...container.querySelectorAll(".drag-handle")];
    expect(handles.length).toBe(5); // 全行に持ち手がある

    // いちばん上（＝手前＝「ロゴ」）を掴み、いちばん下の行の**後ろ半分**＝末尾のすき間へ落とす。
    const rows = [...container.querySelectorAll(".row-between")];
    layoutRows(rows);
    pointerDownAt(handles[0] as HTMLElement, 1000, { button: 0 });
    dragOver(rows[4], { clientX: 100, clientY: 480 }); // いちばん下の行の**後ろ半分**＝末尾のすき間
    dragEnd();

    // ⚠️ **ここが捕まえるのは「反転しているか」**＝すき間の幾何（どのすき間に当たるか）は
    // `useDragReorder` 側で既にテスト済みなので、そこへ依存した厳密な並びは書かない
    //（jsdom の実寸差し込みに左右されて、直したい対象と無関係に落ちる）。
    // **上＝手前**なので、下へ運んだら**奥へ動く＝行の位置は下がる**。反転を落とすと、
    // 同じ操作で `ascending = toIndex` になり **いちばん手前のまま動かない**。
    // ⚠️ **どのすき間に当たるかは幾何が決める**（ここでは下から2番目のすき間）。固定したいのは
    // **向き**＝「上＝手前」なので下へ運べば**奥へ動く**。反転を落とすと `ascending = toIndex` になり、
    // 同じ操作で**手前寄り（上から2番目）**に着く＝下の厳密な並びで区別できる。
    // 「1つでも下がったか」では弱い（反転を落としても1段は下がるので素通りする＝実際に素通りした）。
    expect(rowOrder()).toEqual(["字幕", "ゆうこ", "文字（見出し）", "ロゴ", "背景"]);
  });

  // ⚠️ **持ち手は読み上げに出さない**（`aria-hidden`）＝並べ替えの経路は ↑↓ ボタンが担う（#398 レビュー）。
  it("持ち手は読み上げに出さない（並べ替えは ↑↓ が担う）", () => {
    const { container } = render(<LooksEditScreen onNavigate={vi.fn()} />);
    for (const h of container.querySelectorAll(".drag-handle")) {
      expect(h.getAttribute("aria-hidden")).not.toBeNull();
    }
  });

  it("複製すると1つ増え、元のすぐ手前に入る", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    const before = rowOrder();
    fireEvent.click(screen.getByRole("button", { name: "文字（見出し）を複製" }));
    const after = rowOrder();
    expect(after.length).toBe(before.length + 1);
    // ⚠️ **複製すると2行とも同じ名前**（種別＋紐づけが同じ）なので、`indexOf` では区別できない。
    // 「同じ名前が**隣り合っている**」＝元のすぐ手前に入った、で見る。
    const idx = after.flatMap((n, i) => (n === "文字（見出し）" ? [i] : []));
    expect(idx).toHaveLength(2);
    expect(idx[1] - idx[0]).toBe(1);
  });
});

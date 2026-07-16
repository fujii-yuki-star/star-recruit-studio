// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { FreeLayoutOverlay } from "./FreeLayoutOverlay";
import type { FreeElement } from "../../domain/project/types";
import { FREE_ELEMENT_KIND } from "../../domain/enums";

// #549：FREE テキストのインライン編集は「その場（WYSIWYG）編集」＝実描画（sceneSvg の textToSvg）と同じ体裁で重ねる。
// 以前は fontSize:16・白背景の固定で、実際の文字（例48px・中央揃え・色つき）と乖離した「白い小箱」だった。
const CANVAS_W = 1920;
const CANVAS_H = 1080;
const VIEW_W = 960; // 表示幅＝canvas の半分 → viewScale = 0.5（canvas単位の fontSize を半分の表示pxで出す）

const textEl = {
  id: "free_001", kind: FREE_ELEMENT_KIND.text, x: 100, y: 100, w: 600, h: 200,
  text: "こんにちは", fontSize: 48, color: "#ff0000", textAlign: "center", lineHeight: 1.5, fontWeight: "bold",
} as unknown as FreeElement;

function renderOverlay(over: Partial<ComponentProps<typeof FreeLayoutOverlay>> = {}) {
  const spies = {
    onSelect: vi.fn(), onSelectMany: vi.fn(), onChange: vi.fn(), onMoveMany: vi.fn(), onResizeMany: vi.fn(),
    onRotate: vi.fn(), onDuplicate: vi.fn(), onBringToFront: vi.fn(), onSendToBack: vi.fn(), onDelete: vi.fn(),
    onChangeText: vi.fn(), onRequestEdit: vi.fn(),
  };
  const r = render(
    <FreeLayoutOverlay freeLayout={[textEl]} canvasW={CANVAS_W} canvasH={CANVAS_H} selectedIds={[]} {...spies} {...over} />,
  );
  return { ...r, spies };
}

/** 実機の二度押し（互換 dblclick は来ない・#525-4）でインライン編集へ入る。 */
function enterEdit() {
  const el = document.querySelector('[data-free-id="free_001"]') as HTMLElement;
  const opts = { button: 0, clientX: 10, clientY: 10, pointerId: 1 };
  fireEvent.pointerDown(el, opts);
  fireEvent.pointerUp(el, { pointerId: 1 });
  fireEvent.pointerDown(el, opts);
  return screen.getByRole("textbox") as HTMLTextAreaElement;
}

describe("FreeLayoutOverlay インライン編集の見た目＝実描画に合わせる（#549）", () => {
  // jsdom は実レイアウトを持たず clientWidth が常に 0＝縮尺を測れない。マウント時の計測より前に表示幅を与える。
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => VIEW_W });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  });

  it("文字の大きさは表示スケールへ換算する（canvas 48px × 0.5 = 24px）＝白い小箱の 16px 固定ではない", () => {
    renderOverlay();
    const ta = enterEdit();
    expect(ta.style.fontSize).toBe("24px"); // el.fontSize(48) × viewScale(960/1920)
  });

  it("色・揃え・太さ・行間を要素からミラーし、背景は透明（下のSVGは親が伏せる）", () => {
    renderOverlay();
    const ta = enterEdit();
    expect(ta.style.color).toBe("rgb(255, 0, 0)"); // el.color
    expect(ta.style.textAlign).toBe("center"); // el.textAlign
    expect(ta.style.fontWeight).toBe("bold"); // el.fontWeight
    expect(ta.style.lineHeight).toBe("1.5"); // el.lineHeight（無単位＝SVG の行間と一致）
    expect(ta.style.background).toBe("transparent"); // 旧実装の #fff（白い箱）ではない
    expect(ta.style.padding).toBe("0px"); // 1行目ベースラインを SVG の baseY に合わせる
  });

  it("要素の fontId が未指定なら場面の解決済みフォントを使う（textToSvg と同じ解決順）", () => {
    renderOverlay({ textFontFamily: "TestSceneFont" });
    const ta = enterEdit();
    expect(ta.style.fontFamily).toContain("TestSceneFont");
  });

  // 背景帯（#529）は実描画では同じ TextItem に入る＝親が hideItemIds で伏せると帯ごと消える。編集中だけ下地を失うと
  // 「白文字＋黒帯」のテキストが白背景に白文字＝読めなくなる（旧実装より後退）。同じ帯を textarea にも敷く。
  it("背景帯つきの文字は編集中も同じ帯を敷く（下地を失って読めなくならない）", () => {
    const withBand = { ...textEl, background: { enabled: true, color: "#000000", opacity: 0.55, radius: 16 } } as unknown as FreeElement;
    renderOverlay({ freeLayout: [withBand] });
    const ta = enterEdit();
    expect(ta.style.background).toBe("rgba(0, 0, 0, 0.55)"); // 実描画の帯（bandBackground）と同じ色・濃さ
    expect(ta.style.borderRadius).toBe("16px");
  });

  it("背景帯が無ければ透明のまま（下のSVGは親が伏せる）", () => {
    renderOverlay();
    expect(enterEdit().style.background).toBe("transparent");
  });

  it("要素が既知の fontId を持つならそちらを優先（場面既定より要素・textToSvg と同じ解決順）", () => {
    const withFont = { ...textEl, fontId: "kaitou-yokoku-gothic" } as unknown as FreeElement;
    renderOverlay({ freeLayout: [withFont], textFontFamily: "SceneFallbackFont" });
    const ff = enterEdit().style.fontFamily;
    expect(ff).toContain("Kaitou Yokoku Gothic"); // 要素の fontId が勝つ
    expect(ff).toContain("sans-serif"); // fontFamilyForId＝実描画と同じフォールバック込み（cssFamilyForId の bare 名ではない）
    expect(ff).not.toContain("SceneFallbackFont");
  });

  it("編集中の要素 id を親へ通知する（親が SVG 側を伏せて二重表示を防ぐ）", () => {
    const onEditingIdChange = vi.fn();
    renderOverlay({ onEditingIdChange });
    expect(onEditingIdChange).toHaveBeenLastCalledWith(null); // 初期＝編集していない
    const ta = enterEdit();
    expect(onEditingIdChange).toHaveBeenLastCalledWith("free_001"); // 編集開始＝この要素を伏せる
    fireEvent.blur(ta);
    expect(onEditingIdChange).toHaveBeenLastCalledWith(null); // 編集終了＝また描く
  });
});

// 縮尺が未計測（表示前・パネル幅0など）でも壊れないこと。fontSize は付けない＝極端な大きさで一瞬出るのを避ける。
describe("FreeLayoutOverlay インライン編集：縮尺が未計測のとき（#549）", () => {
  it("clientWidth=0（未計測）でも編集に入れて fontSize を付けない", () => {
    render(
      <FreeLayoutOverlay
        freeLayout={[textEl]} canvasW={CANVAS_W} canvasH={CANVAS_H} selectedIds={[]}
        onSelect={vi.fn()} onSelectMany={vi.fn()} onChange={vi.fn()} onMoveMany={vi.fn()} onResizeMany={vi.fn()}
        onRotate={vi.fn()} onDuplicate={vi.fn()} onBringToFront={vi.fn()} onSendToBack={vi.fn()} onDelete={vi.fn()}
        onChangeText={vi.fn()} onRequestEdit={vi.fn()}
      />,
    );
    const ta = enterEdit(); // clientWidth は jsdom 既定の 0＝viewScale 0
    expect(ta).toBeTruthy(); // クラッシュせず編集に入れる
    expect(ta.style.fontSize).toBe(""); // 誤った大きさを当てない（計測後に付く）
  });
});

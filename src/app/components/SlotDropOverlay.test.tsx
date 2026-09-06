// @vitest-environment jsdom
// 落とし先の目印（#1030 ②）。
//
// ⚠️ **当たり判定が効くこと自体は jsdom では確かめられない**（`elementFromPoint` を持たないので、
// 画面の検査では差し替えている）。実機で一度壊した（PR #1042 レビュー 🔴＝外側の
// `pointer-events:"none"` が受け継がれ、枠が**素通り**して下の SVG が返る）ので、
// **枠に `pointer-events` が戻っていること**だけでも見ておく。
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SlotDropOverlay } from "./SlotDropOverlay";

const targets = [
  { layerId: "background", x: 0, y: 0, w: 1920, h: 1080, assetId: null },
  { layerId: "mainVisual", x: 0, y: 0, w: 960, h: 1080, assetId: "asset_001" },
];
const canvas = { width: 1920, height: 1080 };

describe("SlotDropOverlay（落とし先の目印）", () => {
  const boxes = () => [...document.querySelectorAll<HTMLElement>("[data-slot-drop]")];

  it("枠は当たり判定を持つ（外側の none を受け継がない）", () => {
    render(<SlotDropOverlay targets={targets} canvas={canvas} hoveredLayerId={null} labelOf={() => "素材"} />);
    for (const b of boxes()) expect(b.style.pointerEvents, `${b.dataset.slotDrop} の枠が素通りする`).toBe("auto");
  });

  it("外側の箱は当たり判定を持たない（プレビューの操作を邪魔しない）", () => {
    const { container } = render(
      <SlotDropOverlay targets={targets} canvas={canvas} hoveredLayerId={null} labelOf={() => "素材"} />,
    );
    expect((container.firstElementChild as HTMLElement).style.pointerEvents).toBe("none");
  });

  it("枠は canvas に対する割合で置く（縮尺を自分で持たない）", () => {
    render(<SlotDropOverlay targets={targets} canvas={canvas} hoveredLayerId={null} labelOf={() => "素材"} />);
    const main = boxes().find((b) => b.dataset.slotDrop === "mainVisual")!;
    expect(main.style.width).toBe("50%");
    expect(main.style.height).toBe("100%");
  });

  // ⚠️ **入っている口は「入れ替え」と分かるようにする**（落としてから気づく、を作らない）。
  it("入っている口には入れ替えだと書く", () => {
    render(<SlotDropOverlay targets={targets} canvas={canvas} hoveredLayerId={null} labelOf={(id) => id} />);
    expect(screen.getByText("mainVisual（入れ替え）")).toBeInTheDocument();
    expect(screen.getByText("background")).toBeInTheDocument();
  });
});

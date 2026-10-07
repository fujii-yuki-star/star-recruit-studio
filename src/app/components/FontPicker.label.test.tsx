// @vitest-environment jsdom
// 見出しは部品が描いて欄と結ぶ（#1075）。
//
// ⚠️ **呼び出し側に結び方を書かせない**＝この部品の呼び出しは多く（場面編集9・タイムライン3）、
//    外で `<label htmlFor>` を書く形にすると**結び忘れた所だけ残る**（実際に全部結ばれていなかった）。
// ⚠️ **`<label>` で包んでも結ばれない**＝中身が `<button>`（ラベル可能な部品ではない）だから。
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FontPicker } from "./FontPicker";

describe("FontPicker の見出し（#1075）", () => {
  it("見出しを渡すと、欄と結んで描く", () => {
    const { container } = render(<FontPicker label="この場面のフォント" value={null} onChange={vi.fn()} allowInherit />);
    const label = container.querySelector("label") as HTMLLabelElement;
    expect(label, "見出しを描いていない").not.toBeNull();
    expect(label.textContent).toBe("この場面のフォント");
    expect(label.htmlFor, "見出しが欄と結ばれていない").not.toBe("");
    expect(document.getElementById(label.htmlFor)?.tagName, "結び先が欄ではない").toBe("BUTTON");
  });

  it("見出しといまの値の両方を読み上げる（どの字体かを奪わない）", () => {
    const { container } = render(<FontPicker label="この場面のフォント" value={null} onChange={vi.fn()} allowInherit />);
    const btn = container.querySelector("button") as HTMLButtonElement;
    expect(btn.getAttribute("aria-label"), "見えている値を呼び名で上書きしている").toBeNull();
    // 見出しだけではなく、いま選ばれているもの（継承の言葉）も一緒に読まれる。
    const name = screen.getByRole("button", { name: /この場面のフォント/ });
    expect(name.textContent, "いまの値を見せていない").toContain("動画全体に合わせる");
    expect(screen.getByRole("button", { name: /動画全体に合わせる/ }), "いまの値が呼び名から落ちている").toBeInTheDocument();
  });

  it("見出しを渡さない場所では、呼び名で分かるようにする", () => {
    const { container } = render(<FontPicker value={null} onChange={vi.fn()} allowInherit />);
    expect(container.querySelector("label"), "見出しを渡していないのに描いている").toBeNull();
    // ⚠️ **既定の呼び名は持たない**＝付けると見えている値（字体の名前）を上書きする。
    expect(screen.getByRole("button", { name: /動画全体に合わせる/ })).toBeInTheDocument();
  });

  it("並べても結び先が重ならない（一覧の中で何個あってもよい）", () => {
    const { container } = render(
      <>
        <FontPicker label="見出しのフォント" value={null} onChange={vi.fn()} allowInherit />
        <FontPicker label="本文のフォント" value={null} onChange={vi.fn()} allowInherit />
      </>,
    );
    const ids = [...container.querySelectorAll("label")].map((l) => (l as HTMLLabelElement).htmlFor);
    expect(new Set(ids).size, "結び先が重なっている").toBe(2);
  });
});

// @vitest-environment jsdom
//
// 拡大縮小の操作部品（#142）。⚠️ **3画面が同じものを使う**ので、ここが割れると全部が割れる。
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PreviewZoomControl } from "./PreviewZoomControl";

describe("PreviewZoomControl（#142）", () => {
  // ⚠️ **フィットは 100% とは限らない**＝領域で変わる。「全体」とだけ出すと**どれくらいで見て
  // いるか**が分からないので、実際の%を併記する。
  it("フィット中は「全体」と実際の%を出す", () => {
    render(<PreviewZoomControl zoom="fit" fitPercent={63.4} onChange={vi.fn()} />);
    expect(screen.getByText("全体（63%）")).toBeInTheDocument();
  });

  it("数値のときはその%を出す", () => {
    render(<PreviewZoomControl zoom={150} fitPercent={63} onChange={vi.fn()} />);
    expect(screen.getByText("150%")).toBeInTheDocument();
  });

  // ⚠️ **段は「いまの見え方」から数える**＝フィットが 63% なら拡大は 75%。100% へ飛ばすと
  // **縮んで見える**ことがある（フィットが 140% のとき等）。
  it("フィットからの拡大は、いまの見え方より大きい段へ", () => {
    const onChange = vi.fn();
    render(<PreviewZoomControl zoom="fit" fitPercent={63} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("表示を広げる"));
    expect(onChange).toHaveBeenCalledWith(75);
  });

  it("縮小も同じ数え方", () => {
    const onChange = vi.fn();
    render(<PreviewZoomControl zoom="fit" fitPercent={120} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("表示を縮める"));
    expect(onChange).toHaveBeenCalledWith(100);
  });

  // ⚠️ **押せないときは理由を出す**（§2-5）＝押せるのに何も起きない／押せない理由が無い、を作らない。
  it("端では押せず、理由が出る", () => {
    render(<PreviewZoomControl zoom={200} fitPercent={63} onChange={vi.fn()} />);
    const inBtn = screen.getByLabelText("表示を広げる");
    expect(inBtn).toBeDisabled();
    expect(inBtn.getAttribute("title")).toContain("これ以上は広げられません");
  });

  // ⚠️ **戻す先は「全体」**＝100% に戻すと、狭い領域では画面からはみ出したままになる。
  it("「全体表示」はフィットへ戻す（100% ではない）", () => {
    const onChange = vi.fn();
    render(<PreviewZoomControl zoom={200} fitPercent={63} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "全体表示" }));
    expect(onChange).toHaveBeenCalledWith("fit");
  });

  it("すでに全体なら「全体表示」は押せず、理由が出る", () => {
    render(<PreviewZoomControl zoom="fit" fitPercent={63} onChange={vi.fn()} />);
    const btn = screen.getByRole("button", { name: "全体表示" });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute("title")).toContain("いま全体が見えています");
  });
});

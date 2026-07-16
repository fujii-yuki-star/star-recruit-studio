// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ColorPicker } from "./ColorPicker";

// 自前カラーピッカー（#525-6）。ポップオーバーは body ポータル＋role="dialog"、面/バーは data-testid、
// パレットは aria-label で引ける。jsdom はレイアウトを持たないため面のドラッグは getBoundingClientRect をモックする。

const rect = (left: number, top: number, w = 40, h = 26): DOMRect =>
  ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON: () => undefined }) as DOMRect;

describe("ColorPicker", () => {
  it("見本を押すと色の面・色相バー・定番パレットが出る", () => {
    render(<ColorPicker value="#3b82f6" onChange={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull(); // 初期は閉じている
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("cp-sv")).toBeInTheDocument();
    expect(screen.getByTestId("cp-hue")).toBeInTheDocument();
  });

  it("定番パレットを押すとその色で通知され、色コード欄も新色に同期する", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#222222" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    fireEvent.click(screen.getByRole("button", { name: "色 #22c55e" }));
    expect(onChange).toHaveBeenLastCalledWith("#22c55e");
    // コード欄が古い色（#222222）のまま取り残されない（実機で見つけた不具合の回帰）。
    expect(screen.getByLabelText("色コード")).toHaveValue("#22c55e");
  });

  it("色コード欄に入れると正規化して通知される（#abc→#aabbcc）", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    fireEvent.change(screen.getByLabelText("色コード"), { target: { value: "#abc" } });
    expect(onChange).toHaveBeenLastCalledWith("#aabbcc");
  });

  it("無効な色コードでは通知しない", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    fireEvent.change(screen.getByLabelText("色コード"), { target: { value: "#zz" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("鮮やかさ×明るさの面をドラッグすると新しい色で通知される", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#ff0000" onChange={onChange} />); // 赤（h=0,s=1,v=1）で開く
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    const sv = screen.getByTestId("cp-sv");
    sv.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    // (50,0)＝鮮やかさ0.5・明るさ1・色相0 → #ff8080。
    fireEvent.pointerDown(sv, { clientX: 50, clientY: 0, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith("#ff8080");
  });

  it("色相バーをドラッグすると色相だけ変わる", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#ff0000" onChange={onChange} />); // 赤（s=1,v=1）
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    const hue = screen.getByTestId("cp-hue");
    hue.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 360, height: 14, right: 360, bottom: 14, x: 0, y: 0, toJSON: () => undefined }) as DOMRect;
    // x=120 → 色相120°（緑）・s=1・v=1 → #00ff00。
    fireEvent.pointerDown(hue, { clientX: 120, clientY: 7, pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith("#00ff00");
  });

  it("開いた後の内側スクロールで位置を再計算・クランプする（トリガー追従・#525-6 レビュー P2）", () => {
    // 詳細編集パネルのような内側スクロール領域に置く。capture scroll なので子孫の scroll も拾えることを確認する。
    render(
      <div data-testid="scroller" style={{ overflow: "auto" }}>
        <ColorPicker value="#000000" onChange={vi.fn()} />
      </div>,
    );
    const trigger = screen.getByRole("button", { name: "色を選ぶ" });
    trigger.getBoundingClientRect = () => rect(10, 10);
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog.style.left).toBe("10px"); // 初期＝トリガー左に沿う
    // 内側スクロールでトリガーが右端へ動いた想定 → 元位置に取り残されず再クランプ。
    trigger.getBoundingClientRect = () => rect(window.innerWidth - 20, 300);
    fireEvent.scroll(screen.getByTestId("scroller"));
    expect(dialog.style.left).not.toBe("10px"); // 追従した
    expect(parseFloat(dialog.style.left) + 236).toBeLessThanOrEqual(window.innerWidth - 8 + 0.01); // 画面内に収まる
  });

  it("開いた後のウィンドウ縮小で画面内へ収め直す（#525-6 レビュー P2）", () => {
    const origW = window.innerWidth;
    render(<ColorPicker value="#000000" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "色を選ぶ" });
    trigger.getBoundingClientRect = () => rect(800, 100);
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    const before = parseFloat(dialog.style.left);
    (window as unknown as { innerWidth: number }).innerWidth = 400; // 縮小して右端を内側へ
    fireEvent(window, new Event("resize"));
    expect(parseFloat(dialog.style.left)).toBeLessThan(before); // 左へ寄る
    expect(parseFloat(dialog.style.left) + 236).toBeLessThanOrEqual(400 - 8 + 0.01);
    (window as unknown as { innerWidth: number }).innerWidth = origW; // 後始末（他テストへ影響しない）
  });

  it("Escape で閉じる", () => {
    render(<ColorPicker value="#000000" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("外側クリックで閉じる", () => {
    render(<ColorPicker value="#000000" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("読み上げラベルを渡せる", () => {
    render(<ColorPicker value="#000000" onChange={vi.fn()} ariaLabel="文字の色を選ぶ" />);
    expect(screen.getByRole("button", { name: "文字の色を選ぶ" })).toBeInTheDocument();
  });
});

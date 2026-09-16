// @vitest-environment jsdom
// 右クリックの操作メニュー（ADR-0033）。**開いたまま戻れない**を作らないことを固定する。
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ContextMenu } from "./ContextMenu";

const items = [
  { label: "手前へ", onSelect: vi.fn() },
  { label: "この列を消す", danger: true, onSelect: vi.fn() },
];

describe("ContextMenu", () => {
  it("項目を選ぶと、その操作を呼んで閉じる", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={[{ label: "手前へ", onSelect }]} onClose={onClose} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "手前へ" }));
    expect(onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape で閉じる（キーボードでも抜けられる）", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} items={items} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("画面の外へ出さない（出ると押せない）", () => {
    render(<ContextMenu x={99999} y={99999} items={items} onClose={vi.fn()} />);
    const menu = screen.getByRole("menu") as HTMLElement;
    expect(Number.parseInt(menu.style.left, 10)).toBeLessThanOrEqual(window.innerWidth);
    expect(Number.parseInt(menu.style.top, 10)).toBeLessThanOrEqual(window.innerHeight);
  });

  it("項目が無いときは何も出さない（空のメニューを開かない）", () => {
    render(<ContextMenu x={10} y={10} items={[]} onClose={vi.fn()} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

describe("ContextMenu: いまはできない操作（/canon-check の指摘）", () => {
  it("押せないときは理由を添える（押してから断られる、を作らない）", () => {
    const onSelect = vi.fn();
    render(
      <ContextMenu
        x={10}
        y={10}
        items={[{ label: "この列を消す", disabled: true, disabledHint: "この列は固定されています。消すには固定を外してください", onSelect }]}
        onClose={vi.fn()}
      />,
    );
    const item = screen.getByRole("menuitem", { name: "この列を消す" });
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute("title", "この列は固定されています。消すには固定を外してください");
  });

  // ⚠️ **押せるときは「押したら何が起きるか」を出す**（#1167）＝以前は `disabledHint`（押せない理由）
  //    しか描かなかったので、渡しても**どこにも出ない死んだ受け渡し**になっていた。
  //    ⚠️ **型でも気づけなかった**（スプレッドの余剰プロパティは通る）ので、ここで留める。
  it("押せるときは、押した結果の予告を添える", () => {
    render(
      <ContextMenu
        x={10}
        y={10}
        items={[{ label: "この瞬間で絵を止める", hint: "再生位置から先を、その瞬間の絵で止めます", onSelect: vi.fn() }]}
        onClose={vi.fn()}
      />,
    );
    const item = screen.getByRole("menuitem", { name: "この瞬間で絵を止める" });
    expect(item).toBeEnabled();
    expect(item, "押せるのに予告が出ていない").toHaveAttribute("title", "再生位置から先を、その瞬間の絵で止めます");
  });

  // ⚠️ **2つを混ぜない**＝押せないときに「押したら〜します」と出ると、逆のことを言う。
  it("押せないときは、予告ではなく理由を出す", () => {
    render(
      <ContextMenu
        x={10}
        y={10}
        items={[{
          label: "この瞬間で絵を止める",
          disabled: true,
          disabledHint: "1つだけ選ぶと使えます",
          hint: "再生位置から先を、その瞬間の絵で止めます",
          onSelect: vi.fn(),
        }]}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("menuitem", { name: "この瞬間で絵を止める" }))
      .toHaveAttribute("title", "1つだけ選ぶと使えます");
  });
});

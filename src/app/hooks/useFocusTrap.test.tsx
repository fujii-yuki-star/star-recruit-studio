// @vitest-environment jsdom
// 開いている間だけ焦点をその中に閉じ込め、閉じたら元へ戻す（#986）。
//
// ⚠️ **入る方向だけ塞いで、出る方向が残っていた**＝削除の確認は出た瞬間に「やめる」へ手を移すのに
// （#354）、閉じるときに戻していなかったので、押した瞬間に焦点が `body` へ落ちていた。
// ⚠️ **色を選ぶ面は、そもそも中へ入れなかった**（body の末尾へ出すので `Tab` が画面の続きへ進む）。
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useFocusTrap } from "./useFocusTrap";

function Box({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref);
  return open ? (
    <div ref={ref}>
      <button>中1</button>
      <button>中2</button>
    </div>
  ) : null;
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>ひらく</button>
      <button>外のボタン</button>
      <Box open={open} />
    </>
  );
}

describe("焦点の出し入れ（#986）", () => {
  it("開いたら中へ手が移る", () => {
    render(<Harness />);
    const opener = screen.getByText("ひらく");
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByText("中1"));
  });

  it("閉じたら、開く前に手があった所へ戻る", () => {
    // ⚠️ **ここが #354 の症状の裏側**＝戻さないと `body` へ落ちて、Tab で画面の頭から辿り直しになる。
    const { rerender } = render(<Box open />);
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    rerender(<Box open />); // 開いたまま（再描画で戻さない）
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("`Tab` で外へ出ない（端で反対側へ回る）", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("ひらく"));
    const first = screen.getByText("中1");
    const last = screen.getByText("中2");
    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement, "末尾から先へ進むと先頭へ戻る").toBe(first);
    fireEvent.keyDown(window, { key: "Shift", shiftKey: true }); // 無関係なキーは触らない
    first.focus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement, "先頭から戻ると末尾へ回る").toBe(last);
  });

  it("外に手があるときは、中へ引き戻す（ポータルで末尾へ出す面のため）", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("ひらく"));
    screen.getByText("外のボタン").focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("中1"));
  });

  it("開いていない間は何もしない", () => {
    render(<Harness />);
    const outside = screen.getByText("外のボタン");
    outside.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(outside);
  });
});

describe("閉じるとき、わざと移した手は奪わない（通し点検 2026-10-16）", () => {
  // 列のメニューの「名前を変える」＝選ぶと名前の欄が自分で手を取る。ここで⋮へ奪い返すと、
  // 欄は手を失った瞬間に確定して閉じ、**メニューから名前を変えられなかった**。
  function MenuThenField() {
    const [open, setOpen] = useState(false);
    const [renaming, setRenaming] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>ひらく</button>
        {renaming && <input aria-label="名前" autoFocus onBlur={() => setRenaming(false)} />}
        {open && <MenuBox onPick={() => { setOpen(false); setRenaming(true); }} />}
      </>
    );
  }
  function MenuBox({ onPick }: { onPick: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    useFocusTrap(true, ref);
    return <div ref={ref}><button onClick={onPick}>名前を変える</button></div>;
  }

  it("項目が別の欄へ手を移したら、その欄に手が残る（欄は閉じない）", () => {
    render(<MenuThenField />);
    const opener = screen.getByText("ひらく");
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByText("名前を変える"));
    const field = screen.queryByLabelText("名前");
    expect(field != null, "名前の欄が開いたまま").toBe(true);
    expect(document.activeElement === field, "手は名前の欄にある").toBe(true);
  });

  it("中の要素が消えて body へ落ちたときは、開く前の所へ戻す", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const { rerender } = render(<Box open />);
    expect(document.activeElement === screen.getByText("中1"), "開くと中へ").toBe(true);
    rerender(<Box open={false} />);
    expect(document.activeElement === outside, "body へ落とさない").toBe(true);
    outside.remove();
  });

  it("閉じ込めをやめても中身が残るときは、中に残った手を開く前の所へ戻す", () => {
    function Stay({ active }: { active: boolean }) {
      const ref = useRef<HTMLDivElement>(null);
      useFocusTrap(active, ref);
      return <div ref={ref}><button>残る中身</button></div>;
    }
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const { rerender } = render(<Stay active />);
    expect(document.activeElement === screen.getByText("残る中身"), "開くと中へ").toBe(true);
    rerender(<Stay active={false} />);
    expect(document.activeElement === outside, "中に残った手は戻す").toBe(true);
    outside.remove();
  });
});

// ⚠️ **部品に配線されているか**（#986）＝フックが正しくても、部品が呼んでいなければ効かない。
describe("3つの部品に配線されている（#986）", () => {
  it("削除の確認：閉じると、開く前の所へ手が戻る", async () => {
    const { DeleteConfirm } = await import("../components/DeleteConfirm");
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<DeleteConfirm message="消しますか？" onCancel={() => {}} onConfirm={() => {}} />);
    expect(document.activeElement, "出たら安全な側へ").toBe(screen.getByText("やめる").closest("button"));
    unmount();
    expect(document.activeElement, "閉じたら元へ戻る（body へ落とさない）").toBe(opener);
    opener.remove();
  });

  it("メニュー：開くと中へ手が移り、矢印で動く", async () => {
    const { ContextMenu } = await import("../components/ContextMenu");
    render(
      <ContextMenu
        x={0}
        y={0}
        items={[
          { label: "ひとつめ", onSelect: () => {} },
          { label: "ふたつめ", onSelect: () => {} },
        ]}
        onClose={() => {}}
      />,
    );
    expect(document.activeElement).toBe(screen.getByText("ひとつめ").closest("button"));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByText("ふたつめ").closest("button"));
    // ⚠️ **端で回る**＝行き止まりを作らない。
    fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByText("ひとつめ").closest("button"));
  });

  it("色を選ぶ面：開くと中へ手が移る（キーボードだけで色を変えられる）", async () => {
    const { ColorPicker } = await import("../components/ColorPicker");
    const { useProjectStore } = await import("../store/projectStore");
    useProjectStore.setState({ brandKit: { colors: [] } } as never);
    render(<ColorPicker value="#3b82f6" onChange={() => {}} />);
    const trigger = screen.getByRole("button", { name: "色を選ぶ" });
    trigger.focus();
    fireEvent.click(trigger);
    // ⚠️ **元の穴**＝面は body の末尾へ出るので、開いても手はトリガーに残っていた。
    expect(document.activeElement).not.toBe(trigger);
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
  });
});

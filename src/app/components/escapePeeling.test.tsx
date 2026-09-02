// @vitest-environment jsdom
// ⚠️ **本物の部品どうしで「1段ずつはがれる」ことを確かめる**（#965）。
// 名簿（`escapeOwners.test.ts`）だけでは「配る仕組みができた」ことしか示せず、
// **受け手が実際に名簿へ預けているか**は分からない（自分で購読したまま名乗るのが元の穴だった）。
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ColorPicker } from "./ColorPicker";
import { ContextMenu } from "./ContextMenu";
import { DeleteConfirm } from "./DeleteConfirm";
import { FontPicker } from "./FontPicker";
import { useProjectStore } from "../store/projectStore";
import { FONT_CATALOG } from "../../domain/font/fontCatalog";
import { usePointerDrag } from "../hooks/usePointerDrag";

const menu = (onClose: () => void) => (
  <ContextMenu x={0} y={0} items={[{ label: "消す", onSelect: vi.fn() }]} onClose={onClose} />
);
const esc = (): void => {
  fireEvent.keyDown(window, { key: "Escape" });
};

beforeEach(() => useProjectStore.setState({ userFonts: [], brandKit: { colors: [] } } as never));

describe("Escape は手前から1段ずつはがれる（#965）", () => {
  it("メニューを開いたまま確認を出すと、1回目は確認だけ・2回目でメニュー", () => {
    // 元の穴＝どちらも「名乗るだけ」で自分で購読していたので、**両方いっぺんに閉じた**。
    const onClose = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <>
        {menu(onClose)}
        <DeleteConfirm message="消しますか？" onCancel={onCancel} onConfirm={vi.fn()} />
      </>,
    );
    esc();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled(); // ここが本体（一緒に閉じない）
    // ⚠️ **奥へ渡ることも同じテストの中で見る**＝別のテストへ預けると、
    // 1段目を消しても緑のまま通る（#965 レビュー 🟡）。
    rerender(<>{menu(onClose)}</>);
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("確認が出ている最中にメニューを開くと、1回目はメニューだけ", () => {
    // ⚠️ **逆の並びも要る**＝確認が必ず後から出る並びしか試さないと、
    // 「確認だけが名簿へ預けていない」変異を捕まえられない（実際に緑のまま通った）。
    const onClose = vi.fn();
    const onCancel = vi.fn();
    const confirm = <DeleteConfirm message="消しますか？" onCancel={onCancel} onConfirm={vi.fn()} />;
    const { rerender } = render(<>{confirm}</>);
    rerender(
      <>
        {confirm}
        {menu(onClose)}
      </>,
    );
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled(); // 確認は残る（答えるまで消えない）
  });

  it("受け手が1つだけのときは、これまでどおり閉じる", () => {
    const onCancel = vi.fn();
    render(<DeleteConfirm message="消しますか？" onCancel={onCancel} onConfirm={vi.fn()} />);
    esc();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText("消しますか？")).toBeInTheDocument();
  });

  it("確認が見送ったときは、奥の受け手へ渡る（黙って死なせない）", () => {
    // ⚠️ **これが「順番だけ」では直せなかった穴**（#965 レビュー 🟡）＝
    // 確認は「箱の外の入力欄に手があるとき」受け取らない。順番だけの作りだと、
    // 手前が見送った時点で**下の受け手も黙り**、`Escape` が完全に死んでいた。
    const onCancel = vi.fn();
    const area = document.createElement("textarea");
    document.body.appendChild(area);
    // ⚠️ **確認を後から出す**＝確認が手前でないと「見送り」の道に入らない（下が受けて緑になる）。
    const picker = <FontPicker value={null} onChange={vi.fn()} allowInherit />;
    const { rerender } = render(<>{picker}</>);
    fireEvent.click(screen.getByRole("button", { name: /動画全体に合わせる/ }));
    const opened = FONT_CATALOG[0]!.label;
    expect(screen.getAllByText(opened).length).toBeGreaterThan(0);
    rerender(
      <>
        {picker}
        <DeleteConfirm message="消しますか？" onCancel={onCancel} onConfirm={vi.fn()} />
      </>,
    );
    area.focus();
    esc();
    expect(onCancel).not.toHaveBeenCalled(); // 打っている最中は確認を横取りしない
    expect(screen.queryAllByText(opened)).toHaveLength(0); // 見送りが奥へ渡り、選び欄が閉じた
    area.remove();
  });

  it("色を選ぶ面を開いたまま確認を出すと、1回目は確認だけ", () => {
    // ⚠️ **#965 で報告された筋そのもの**＝選び欄を開く → クリックを挟まず Tab で削除ボタンへ →
    // Enter で確認を開く。**確認が後から前へ出る**ので、1回目は確認だけがはがれる。
    const onCancel = vi.fn();
    const picker = <ColorPicker value="#3b82f6" onChange={vi.fn()} />;
    const { rerender } = render(<>{picker}</>);
    fireEvent.click(screen.getByRole("button", { name: "色を選ぶ" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    rerender(
      <>
        {picker}
        <DeleteConfirm message="消しますか？" onCancel={onCancel} onConfirm={vi.fn()} />
      </>,
    );
    esc();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // 面は残る（1回で2段はがれない）
    // ⚠️ **2回目で面が閉じることまで見る**＝ここが無いと、面が名乗っていなくても緑になる。
    rerender(<>{picker}</>);
    esc();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("項目の無いメニューは名乗らない（描かれないのに順番を占めない）", () => {
    // ⚠️ フックは早い `return` より**前**に走るので、条件を付けないと**空のメニューが手前を占める**。
    const onCancel = vi.fn();
    render(
      <>
        <DeleteConfirm message="消しますか？" onCancel={onCancel} onConfirm={vi.fn()} />
        <ContextMenu x={0} y={0} items={[]} onClose={vi.fn()} />
      </>,
    );
    esc();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("掴んでいる最中に前へ出た受け手が先で、掴みは次の Escape でやめる", () => {
    const onCancel = vi.fn();
    const onClose = vi.fn();
    function Grabbable() {
      const [menuOpen, setMenuOpen] = useState(false);
      const begin = usePointerDrag();
      return (
        <>
          <button type="button" onPointerDown={(e) => begin(e, { onMove: () => {}, onCancel })}>
            つかむ
          </button>
          <button type="button" onClick={() => setMenuOpen(true)}>
            メニューを出す
          </button>
          {menuOpen ? menu(onClose) : null}
        </>
      );
    }
    render(<Grabbable />);
    fireEvent.pointerDown(screen.getByText("つかむ"), { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 200, clientY: 100, buttons: 1 });
    fireEvent.click(screen.getByText("メニューを出す"));
    esc();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled(); // 掴みは残る
  });
});

// ⚠️ **レビューで挙がった「理論上の余地」を実測で確かめる**（#973 レビュー）＝
// 確認は `document.activeElement` を見て見送るので、**同じ Escape の中で欄が先に `blur()` する**と、
// 見た時点では焦点が外れており「打っていない」と判断して受け取ってしまうのではないか。
describe("欄が自分で抜ける Escape と、確認の見送り（#965／#973 レビュー）", () => {
  it("欄が先に抜けても、その1回で確認まで答えたことにならない", () => {
    // 欄は自分の `onKeyDown` で抜ける（タイムライン編集の差し込み口・文字欄と同じ形）。
    const onCancel = vi.fn();
    function Field() {
      return (
        <input
          aria-label="欄"
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
          }}
        />
      );
    }
    render(
      <>
        <Field />
        <DeleteConfirm message="消しますか？" onCancel={onCancel} onConfirm={vi.fn()} />
      </>,
    );
    const field = screen.getByLabelText("欄");
    field.focus();
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(document.activeElement).not.toBe(field); // 1段目＝欄を抜ける
    expect(onCancel).not.toHaveBeenCalled(); // ⚠️ ここが本体＝2段いっぺんに進まない
  });
});

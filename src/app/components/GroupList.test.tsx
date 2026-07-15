// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { GroupList } from "./GroupList";
import type { Group } from "../../domain/group/types";

const groups: Group[] = [
  { id: "group_001", members: ["free_001"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } },
  { id: "group_002", members: ["free_002"], transform: { x: 0, y: 0, rotation: 0, scale: 1 }, name: "背景まとまり", hidden: true },
];

function setup(over: Partial<ComponentProps<typeof GroupList>> = {}) {
  const spies = { onSelect: vi.fn(), onToggleHidden: vi.fn(), onRename: vi.fn() };
  render(<GroupList groups={groups} activeGroupId={null} {...spies} {...over} />);
  return spies;
}

describe("GroupList（#525-9 グループ一覧）", () => {
  it("名前未設定は自動名（グループN）・設定済みはその名前・非表示は「（非表示）」", () => {
    setup();
    expect(screen.getByText(/グループ1/)).toBeTruthy(); // 自動名
    expect(screen.getByText(/背景まとまり（非表示）/)).toBeTruthy(); // 名前＋非表示ラベル
  });

  it("空リストは何も描画しない（null）", () => {
    const { container } = render(<GroupList groups={[]} activeGroupId={null} onSelect={vi.fn()} onToggleHidden={vi.fn()} onRename={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("グループ名クリックで onSelect（隠したグループも選び直せる）", () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByText(/背景まとまり/)); // 非表示グループを選ぶ
    expect(onSelect).toHaveBeenCalledWith("group_002");
  });

  it("「表示」で onToggleHidden（隠したグループを戻せる）", () => {
    const { onToggleHidden } = setup();
    fireEvent.click(screen.getByRole("button", { name: "表示する" })); // hidden の group_002 だけが「表示する」
    expect(onToggleHidden).toHaveBeenCalledWith("group_002");
  });

  it("「名前」→入力→Enter で onRename（改名）", () => {
    const { onRename } = setup();
    fireEvent.click(screen.getAllByRole("button", { name: "名前を変更" })[0]); // group_001
    const input = screen.getByLabelText("グループ名");
    fireEvent.change(input, { target: { value: "タイトル群" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("group_001", "タイトル群");
  });

  it("改名を Escape で取り消すと onRename を呼ばない", () => {
    const { onRename } = setup();
    fireEvent.click(screen.getAllByRole("button", { name: "名前を変更" })[0]);
    fireEvent.keyDown(screen.getByLabelText("グループ名"), { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
  });
});

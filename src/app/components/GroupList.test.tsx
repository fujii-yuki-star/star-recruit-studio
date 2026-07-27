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
  const spies = { onSelect: vi.fn(), onToggleHidden: vi.fn(), onRename: vi.fn(), onDelete: vi.fn() };
  render(<GroupList groups={groups} activeGroupId={null} memberCount={() => 1} {...spies} {...over} />);
  return spies;
}

describe("GroupList（#525-9 グループ一覧）", () => {
  it("名前未設定は自動名（グループN）・設定済みはその名前・非表示は「（非表示）」", () => {
    setup();
    expect(screen.getByText(/グループ1/)).toBeTruthy(); // 自動名
    expect(screen.getByText(/背景まとまり（非表示）/)).toBeTruthy(); // 名前＋非表示ラベル
  });

  it("空リストは何も描画しない（null）", () => {
    const { container } = render(<GroupList groups={[]} activeGroupId={null} onSelect={vi.fn()} onToggleHidden={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} memberCount={() => 0} />);
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

  it("改名ボタンは名詞ラベルでなくアイコン＋『名前を変更』（動詞規約・#547 P3-6）", () => {
    setup();
    const btn = screen.getAllByRole("button", { name: "名前を変更" })[0];
    expect(btn.querySelector("svg")).not.toBeNull(); // ペンアイコンで示す
    expect(btn.textContent).toBe(""); // 可視ラベルに名詞「名前」を出さない
  });

  it("「名前を変更」→入力→Enter で onRename（改名）", () => {
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

describe("GroupList：中身ごと削除（#551）", () => {
  it("削除を押すと確認が出る（すぐには消さない）", () => {
    const { onDelete } = setup({ memberCount: () => 3 });
    fireEvent.click(screen.getByRole("button", { name: "グループ1を中身ごと削除" }));
    expect(onDelete).not.toHaveBeenCalled(); // 確認前は消えない
    // 中身が何個消えるかを押す前に伝える（§2-5）。
    expect(screen.getByText(/「グループ1」を中身ごと削除しますか？この中の3個の要素も一緒に消えます。/)).toBeTruthy();
  });

  it("「削除する」で onDelete が呼ばれ、「やめる」で呼ばれない", () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByRole("button", { name: "グループ1を中身ごと削除" }));
    fireEvent.click(screen.getByText("やめる"));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "グループ1を中身ごと削除" })).toBeTruthy(); // 行が戻る

    fireEvent.click(screen.getByRole("button", { name: "グループ1を中身ごと削除" }));
    fireEvent.click(screen.getByText("削除する"));
    expect(onDelete).toHaveBeenCalledWith("group_001");
  });

  it("確認は押した行だけを差し替える（他の行はそのまま操作できる）", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "グループ1を中身ごと削除" }));
    expect(screen.getByRole("button", { name: "背景まとまりを中身ごと削除" })).toBeTruthy(); // 別の行は残る
  });

  it("ロック中のグループは削除できない＝理由を説明に出す", () => {
    const locked: Group[] = [{ id: "group_001", members: ["free_001"], transform: { x: 0, y: 0, rotation: 0, scale: 1 }, locked: true }];
    setup({ groups: locked });
    const btn = screen.getByRole("button", { name: "グループ1を中身ごと削除" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringContaining("ロック") as unknown as string);
  });

  // 画面固有の制約（テンプレ作成の「最低1枚」など）は理由つきで親から渡す＝押せない理由が分かる（§2-5）。
  it("親が理由を返したら削除を無効化し、その理由を説明に出す", () => {
    setup({ deleteDisabledReason: (id) => (id === "group_001" ? "全部が消えてしまうため削除できません" : undefined) });
    const g1 = screen.getByRole("button", { name: "グループ1を中身ごと削除" });
    expect(g1).toBeDisabled();
    expect(g1).toHaveAttribute("title", "全部が消えてしまうため削除できません");
    expect(screen.getByRole("button", { name: "背景まとまりを中身ごと削除" })).not.toBeDisabled(); // 理由が無い行は押せる
  });
});

// #551 レビュー P2：確認を開いたまま別の場所でロック/制約に触れると、内側のガードが無言 return して
// 「消えたはずが消えていない」サイレント失敗になる。確認中に削除不可へ変わったら確認を引っ込める。
describe("GroupList：確認中に削除できなくなったら確認を引っ込める（#551 レビュー P2）", () => {
  const unlocked: Group[] = [{ id: "group_001", members: ["free_001"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }];
  const locked: Group[] = [{ ...unlocked[0], locked: true }];

  it("確認中にロックされたら確認が消え、理由つきの無効ボタンへ戻る", () => {
    const onDelete = vi.fn();
    const { rerender } = render(
      <GroupList groups={unlocked} activeGroupId={null} onSelect={vi.fn()} onToggleHidden={vi.fn()} onRename={vi.fn()} onDelete={onDelete} memberCount={() => 1} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "グループ1を中身ごと削除" }));
    expect(screen.getByText("削除する")).toBeTruthy(); // 確認が出ている

    // 別の場所（選択中グループのツールバー等）でロックされた＝props が更新される。
    rerender(
      <GroupList groups={locked} activeGroupId={null} onSelect={vi.fn()} onToggleHidden={vi.fn()} onRename={vi.fn()} onDelete={onDelete} memberCount={() => 1} />,
    );
    expect(screen.queryByText("削除する")).toBeNull(); // 確認は消える＝押して無言で失敗する窓が無い
    expect(screen.getByRole("button", { name: "グループ1を中身ごと削除" })).toBeDisabled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("確認中に親が理由を返し始めたら確認が消える（テンプレの最低1枚など）", () => {
    const onDelete = vi.fn();
    const props = { groups: unlocked, activeGroupId: null, onSelect: vi.fn(), onToggleHidden: vi.fn(), onRename: vi.fn(), onDelete, memberCount: () => 1 };
    const { rerender } = render(<GroupList {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "グループ1を中身ごと削除" }));
    expect(screen.getByText("削除する")).toBeTruthy();

    rerender(<GroupList {...props} deleteDisabledReason={() => "全部が消えてしまうため削除できません"} />);
    expect(screen.queryByText("削除する")).toBeNull();
    expect(screen.getByRole("button", { name: "グループ1を中身ごと削除" })).toHaveAttribute("title", "全部が消えてしまうため削除できません");
  });
});

// #547 P2-12：選択ハイライトの塗りは主操作色（青緑）と同色相のトークンで出す。
// 従来は別色相の青 rgba(80,130,255) 直書きで、選択枠（--color-primary）と色がちぐはぐだった。
describe("GroupList 選択ハイライトの色（#547 P2-12）", () => {
  it("選択行の背景は共有トークン var(--color-primary-rgb) を使い、旧オフパレット青を使わない", () => {
    const { container } = render(
      <GroupList groups={groups} activeGroupId="group_001" memberCount={() => 1}
        onSelect={vi.fn()} onToggleHidden={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />,
    );
    const styles = Array.from(container.querySelectorAll<HTMLElement>(".row-between")).map((n) => n.getAttribute("style") ?? "");
    const selected = styles.filter((s) => s.includes("var(--color-primary-rgb)"));
    expect(selected.length).toBe(1); // 選択された1行だけがハイライト
    expect(styles.some((s) => s.includes("80,130,255") || s.includes("80, 130, 255"))).toBe(false); // 旧青は残っていない
  });
})

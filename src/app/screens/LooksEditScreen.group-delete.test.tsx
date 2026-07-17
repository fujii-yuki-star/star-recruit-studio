// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Layer, Template } from "../../domain/template/types";
import { LooksEditScreen } from "./LooksEditScreen";

// #551：テンプレ作成エディタでもグループを中身ごと削除できる（グループは両エディタ共通・ADR-0022）。
// この画面のグループ機能は従来から画面レベル未検証だった（#551 レビュー ℹ️）。特に `wouldEmptyTemplate`
// （`template.schema` の `layers.minItems:1`）はこの画面固有の境界値ロジック（§7）。
const layer = (id: string, extra: Partial<Layer> = {}): Layer =>
  ({ id, type: "shape", x: 0, y: 0, w: 100, h: 100, ...extra }) as Layer;

/** レイヤー4枚・うち2枚が group_001。削除しても2枚残る＝最低1枚を割らない。 */
const tpl = (over: Partial<Template> = {}): Template =>
  ({
    ...sampleTemplates[0],
    templateId: "user_tmpl_001",
    name: "マイ見た目",
    layers: [layer("l1"), layer("l2"), layer("l3"), layer("l4")],
    groups: [{ id: "group_001", members: ["l1", "l2"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }],
    ...over,
  }) as Template;

const setup = (t: Template = tpl()) => {
  useProjectStore.setState({ templates: [t, ...sampleTemplates], assets: [], editingTemplateId: "user_tmpl_001" });
  render(<LooksEditScreen onNavigate={vi.fn()} />);
};

/** グループ一覧の行（自動名「グループ1」）を押して選択＝操作ツールバーを出す。 */
// 行の選択ボタン＝名前そのもの。ロック中は「グループ1（ロック）」になる一方、削除ボタンは
// 「グループ1を中身ごと削除」なので、括弧か行末で終わる形に限定して取り違えない。
const selectGroup = () => fireEvent.click(screen.getByRole("button", { name: /^グループ1(（|$)/ }));
const deleteBtn = () => screen.getAllByText("削除").find((e) => e.closest("button")) as HTMLElement;

describe("LooksEditScreen グループを中身ごと削除（#551）", () => {
  beforeEach(() => {
    useProjectStore.setState({ templates: [], assets: [], editingTemplateId: null });
  });

  it("確認して削除するとメンバーのレイヤーとグループが消える（グループ外は残る）", () => {
    setup();
    selectGroup();
    fireEvent.click(within(screen.getByText(/グループを選択中/).parentElement as HTMLElement).getByText("削除"));
    expect(screen.getByText(/中の2個の要素も一緒に消えます/)).toBeTruthy(); // 押す前に何個消えるか分かる
    fireEvent.click(screen.getByText("削除する"));

    // draft はローカル state なので、画面の重ね順一覧（レイヤー名）で結果を見る。
    expect(screen.queryByRole("button", { name: /^グループ1(（|$)/ })).toBeNull(); // グループ行が消えた
  });

  // template.schema の layers.minItems:1（既存 onRemoveLayer と同じ制約）。全レイヤーを含むグループを
  // 消すとスキーマ違反のテンプレになるので、押せない＋理由を出す（黙って無視しない・§2-5）。
  it("全レイヤーを含むグループは削除できない＝理由を出す（最低1枚の境界値）", () => {
    setup(tpl({ layers: [layer("l1"), layer("l2")], groups: [{ id: "group_001", members: ["l1", "l2"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }] }));
    selectGroup();
    const btn = deleteBtn().closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain("全部が消えてしまうため削除できません");
  });

  it("1枚でも残るなら削除できる（境界の反対側）", () => {
    setup(tpl({ layers: [layer("l1"), layer("l2"), layer("l3")], groups: [{ id: "group_001", members: ["l1", "l2"], transform: { x: 0, y: 0, rotation: 0, scale: 1 } }] }));
    selectGroup();
    expect((deleteBtn().closest("button") as HTMLButtonElement).disabled).toBe(false);
  });

  // #551 レビュー P2：確認中も操作ツールバー（ロック含む）が出ていると、ロック→「削除する」で
  // 内側のガードが無言 return し、確認だけ閉じて「消えたはずが消えていない」になる。
  it("確認中は操作ツールバーを隠す＝確認中にロックできる窓を作らない", () => {
    setup();
    selectGroup();
    fireEvent.click(within(screen.getByText(/グループを選択中/).parentElement as HTMLElement).getByText("削除"));
    expect(screen.getByText("削除する")).toBeTruthy(); // 確認中
    expect(screen.queryByText(/グループを選択中/)).toBeNull(); // 操作列（ロック/解除/削除）は隠れる
  });

  it("「やめる」で操作ツールバーが戻る", () => {
    setup();
    selectGroup();
    fireEvent.click(within(screen.getByText(/グループを選択中/).parentElement as HTMLElement).getByText("削除"));
    fireEvent.click(screen.getByText("やめる"));
    expect(screen.getByText(/グループを選択中/)).toBeTruthy();
  });

  it("ロック中のグループは削除できない（ボタンが無効・理由つき）", () => {
    setup(tpl({ groups: [{ id: "group_001", members: ["l1", "l2"], transform: { x: 0, y: 0, rotation: 0, scale: 1 }, locked: true }] }));
    selectGroup();
    const btn = deleteBtn().closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain("ロック");
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Layer } from "../../domain/template/types";

// #788-3：見た目パターン編集のキャンバスは**掴んで動かせるのにキーでは動かせなかった**
//（#769 で揃えたのは `Escape`／`Ctrl+Z` の遮断まで＝矢印と `Delete` は結線されていなかった）。
// ADR-0034 決定19＝**ドラッグ専用の操作を作らない**。場面編集の自由配置と**同じ部品**（`KeyboardNudge`）へ乗せる。
//
// オーバーレイは差し替え、画面が渡す境界だけを叩く（この画面の既存テストと同じ流儀＝jsdom のレイアウト不在に依存しない）。
const captured = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("../components/TemplateLayerOverlay", () => ({
  TemplateLayerOverlay: (props: Record<string, unknown>) => {
    captured.props = props;
    return null;
  },
}));

const { LooksEditScreen } = await import("./LooksEditScreen");

const userTemplate = {
  ...sampleTemplates[0],
  templateId: "user_tmpl_001",
  name: "マイ見た目",
  layers: [
    { id: "layer_a", type: "text", x: 100, y: 200, w: 400, h: 120, zIndex: 2, textKey: "title" },
    { id: "layer_b", type: "shape", x: 0, y: 0, w: 200, h: 200, zIndex: 1 },
  ],
} as unknown as (typeof sampleTemplates)[number];

describe("見た目パターン編集：キーでも動かせる・消せる（#788-3）", () => {
  beforeEach(() => {
    captured.props = null;
    useProjectStore.setState({
      templates: [userTemplate, ...sampleTemplates], assets: [], scenes: [], editingTemplateId: "user_tmpl_001",
    } as never);
    useProjectStore.getState().setExportRun({ phase: "idle" });
  });

  const overlay = () => captured.props as unknown as { layers: Layer[]; onSelect: (id: string) => void };
  const layerOf = (id: string): Layer => overlay().layers.find((l) => l.id === id)!;
  const select = (id: string): void => { act(() => overlay().onSelect(id)); };

  it("矢印キーで選んだ層が 1px 動く（Shift で 10px）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(layerOf("layer_a")).toMatchObject({ x: 101, y: 200 });
    fireEvent.keyDown(window, { key: "ArrowDown", shiftKey: true });
    expect(layerOf("layer_a")).toMatchObject({ x: 101, y: 210 });
    expect(layerOf("layer_b")).toMatchObject({ x: 0, y: 0 }); // 選んでいない層は動かない
  });

  it("Delete で選んだ層を消す（一覧の削除ボタンと同じ入口）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    fireEvent.keyDown(window, { key: "Delete" });
    expect(overlay().layers.map((l) => l.id)).toEqual(["layer_b"]);
  });

  // ⚠️ **最後の1枚は消さない**（`template.schema` の `layers.minItems:1`＝一覧の削除ボタンと同じ制約）。
  // ⚠️ 消せないときは **`Delete` を奪わない**ところまで見る＝奪って何も起きないと「効かないキー」になる
  // （決定5＝行き止まりを作らない）。消えないことだけ見ても、内側の守りが効いているだけかもしれない。
  it("最後の1枚では Delete を奪わない（押しても何も起きないキーを作らない）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    // 消せるときは奪う（`fireEvent` は既定を止めると false を返す）。
    expect(fireEvent.keyDown(window, { key: "Delete" })).toBe(false);
    expect(overlay().layers.map((l) => l.id)).toEqual(["layer_b"]);

    select("layer_b"); // 残り1枚＝消せない
    expect(fireEvent.keyDown(window, { key: "Delete" })).toBe(true); // 奪わない
    expect(overlay().layers.map((l) => l.id)).toEqual(["layer_b"]);
  });

  // ⚠️ **打っている最中は奪わない**（共通判定＝`isTextEntryTarget`）。奪うと名前を打っている途中で層が動く。
  it("入力欄に打っている間は矢印を奪わない", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    fireEvent.keyDown(screen.getByDisplayValue("マイ見た目"), { key: "ArrowRight" });
    expect(layerOf("layer_a")).toMatchObject({ x: 100 });
  });

  // ⚠️ レビュー指摘＝このPRのコメントが明示した仕様（まとまりごと動く）が丸ごと無テストだった。
  it("まとまりを選んでいるときは、まとまりごと動く（中の層の座標は変えない）", () => {
    useProjectStore.setState({
      templates: [{ ...userTemplate, groups: [{ id: "group_001", members: ["layer_a"], transform: { x: 0, y: 0, scale: 1, rotation: 0 } }] } as never, ...sampleTemplates],
    } as never);
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    act(() => (captured.props as unknown as { onSelectGroup: (id: string) => void }).onSelectGroup("group_001"));
    fireEvent.keyDown(window, { key: "ArrowRight" });
    const groups = (captured.props as unknown as { groups: { id: string; transform: { x: number; y: number } }[] }).groups;
    expect(groups[0].transform).toMatchObject({ x: 1, y: 0 }); // まとまりが動く
    expect(layerOf("layer_a")).toMatchObject({ x: 100 });      // 中の層の座標はそのまま
  });

  // ⚠️ **固定したまとまりは動かさない**＝掴んで動かす方は固定なら選ぶだけで止まる。
  // キーだけ通ると「掴めないのにキーでは動く」になる（同じ理由で入口ごとに結果が変わる）。
  it("固定したまとまりは矢印でも動かない", () => {
    useProjectStore.setState({
      templates: [{ ...userTemplate, groups: [{ id: "group_001", members: ["layer_a"], transform: { x: 0, y: 0, scale: 1, rotation: 0 }, locked: true }] } as never, ...sampleTemplates],
    } as never);
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    act(() => (captured.props as unknown as { onSelectGroup: (id: string) => void }).onSelectGroup("group_001"));
    expect(fireEvent.keyDown(window, { key: "ArrowRight" })).toBe(true); // 奪わない
    const groups = (captured.props as unknown as { groups: { transform: { x: number } }[] }).groups;
    expect(groups[0].transform.x).toBe(0);
  });

  // ⚠️ **固定したまとまりの中の層も動かさない**（一覧から個別に選べてしまうため）。
  it("固定したまとまりの中の層は、個別に選んでも矢印で動かない", () => {
    useProjectStore.setState({
      templates: [{ ...userTemplate, groups: [{ id: "group_001", members: ["layer_a"], transform: { x: 0, y: 0, scale: 1, rotation: 0 }, locked: true }] } as never, ...sampleTemplates],
    } as never);
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(layerOf("layer_a")).toMatchObject({ x: 100 });
  });

  // ⚠️ 何も選んでいないときに奪うと、欄のスクロールが効かないのに何も起きない（行き止まり）。
  it("何も選んでいないときは矢印を奪わない", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    expect(fireEvent.keyDown(window, { key: "ArrowRight" })).toBe(true);
  });

  // ⚠️ **変換中は奪わない**の配線（レビュー指摘＝共通判定は単体試験済みだが、繋がっているかは未検証だった）。
  it("日本語を変換している最中は矢印を奪わない", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    fireEvent.keyDown(window, { key: "ArrowRight", isComposing: true });
    expect(layerOf("layer_a")).toMatchObject({ x: 100 });
  });

  it("取り消しで戻せる（キーで動かした結果も履歴に載る）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(layerOf("layer_a")).toMatchObject({ x: 101 });
    fireEvent.click(screen.getByLabelText("取り消す").closest("button") as HTMLButtonElement);
    expect(layerOf("layer_a")).toMatchObject({ x: 100 });
  });

  // ⚠️ **押しっぱなしでも取り消しは1回ぶん**（`06 §12.1` 決定20＝タイムラインと同じ）。
  // 1打鍵ごとに積むと、キーリピートで履歴の上限を数秒で流し切り、**この画面唯一の戻り道**が消える。
  it("続けて押したぶんは1回の取り消しでまとめて戻る", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    select("layer_a");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(layerOf("layer_a")).toMatchObject({ x: 103 });
    fireEvent.click(screen.getByLabelText("取り消す").closest("button") as HTMLButtonElement);
    expect(layerOf("layer_a")).toMatchObject({ x: 100 }); // 3回ぶんが1回で戻る
  });
});

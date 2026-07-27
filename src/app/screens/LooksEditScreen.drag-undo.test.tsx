// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";

// #547 P2-3：**画面の結線**（1ドラッグ＝1取り消し）を固定する回帰テスト。
// オーバーレイ実体は差し替え、画面が渡す境界コールバックだけを直接叩く（実オーバーレイ側が実際に発火することは
// `TemplateLayerOverlay.test.tsx` で別途検証済み＝jsdom のレイアウト不在に依存しない形で結線だけを見る）。
// これが無いと「境界を渡し忘れ／伝播頼みで発火しない」退行が素通りし、ドラッグ1回で履歴上限（50）を食い潰す。
const captured = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock("../components/TemplateLayerOverlay", () => ({
  TemplateLayerOverlay: (props: Record<string, unknown>) => {
    captured.props = props;
    return null;
  },
}));

const { LooksEditScreen } = await import("./LooksEditScreen");

const userTemplate = { ...sampleTemplates[0], templateId: "user_tmpl_001", name: "マイ見た目" };

describe("LooksEditScreen ドラッグの取り消し境界（#547 P2-3）", () => {
  beforeEach(() => {
    captured.props = null;
    useProjectStore.setState({ templates: [userTemplate, ...sampleTemplates], assets: [], editingTemplateId: "user_tmpl_001" });
  });

  const undoBtn = (): HTMLButtonElement => screen.getByLabelText("取り消す").closest("button") as HTMLButtonElement;

  it("画面はオーバーレイへ合成境界を渡す（伝播頼みにしない）", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    expect(typeof captured.props?.onInteractionStart).toBe("function");
    expect(typeof captured.props?.onInteractionEnd).toBe("function");
  });

  it("1回のドラッグ（開始→連続変更→終了）は1回の取り消しでまとめて戻る", () => {
    render(<LooksEditScreen onNavigate={vi.fn()} />);
    const p = captured.props as unknown as {
      onInteractionStart: () => void;
      onInteractionEnd: () => void;
      onChange: (id: string, geom: { x: number; y: number }) => void;
    };
    const layerId = userTemplate.layers[0].id;

    expect(undoBtn().disabled).toBe(true); // ドラッグ前は履歴なし
    act(() => p.onInteractionStart());
    act(() => p.onChange(layerId, { x: 10, y: 10 })); // pointermove ごとの連続更新…
    act(() => p.onChange(layerId, { x: 20, y: 20 }));
    act(() => p.onChange(layerId, { x: 30, y: 30 }));
    act(() => p.onInteractionEnd());

    expect(undoBtn().disabled).toBe(false); // 変更されたので戻せる
    fireEvent.click(undoBtn());
    // 1回で足りる＝履歴は1件だけ（合成が壊れていれば3件積まれ、まだ戻せる状態が残る）。
    expect(undoBtn().disabled).toBe(true);
  });
});

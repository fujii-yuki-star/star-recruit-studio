// @vitest-environment jsdom
//
// 開いている動画の場面が0になったとき（通し点検 2026-10-16）。
//
// ⚠️ **取り消しを重ねて場面が無くなると行き止まりだった**＝「新しい動画を作る」しか出ず、やり直す・場面を足す・
// 台本表へ戻るがマウスでは無かった（`Ctrl+Y` でしか戻れない＝§2-5）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { SceneEditScreen } from "./SceneEditScreen";

describe("SceneEditScreen 場面が0の動画", () => {
  const redo = vi.fn();
  const addScene = vi.fn(() => "scene_001");

  beforeEach(() => {
    redo.mockClear();
    addScene.mockClear();
    const meta = useProjectStore.getState().meta;
    useProjectStore.setState({
      meta: { ...meta, projectId: "proj_20261016_001" },
      status: "ready",
      scenes: [], parts: [], assets: [], editingSceneId: null,
      past: [], future: [{} as never], _historyGroupDepth: 0, saveStatus: "saved",
      redo, addScene,
    });
  });

  it("やり直す・場面を追加・台本表へ戻るを出す", () => {
    const onNavigate = vi.fn();
    render(<SceneEditScreen onNavigate={onNavigate} />);
    expect(screen.getByText("この動画には場面がありません")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "↷ やり直す" }));
    expect(redo).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "場面を追加" }));
    expect(addScene).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "台本表へ戻る" }));
    expect(onNavigate).toHaveBeenCalledWith("draft");
  });

  it("やり直せるものが無ければ「やり直す」は出さない", () => {
    useProjectStore.setState({ future: [] });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "↷ やり直す" })).toBeNull();
    expect(screen.getByRole("button", { name: "場面を追加" })).toBeTruthy();
  });

  it("動画を開いていないときは、これまでどおり新しい動画を作る案内", () => {
    const meta = useProjectStore.getState().meta;
    useProjectStore.setState({ meta: { ...meta, projectId: "" } });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("編集する場面がありません")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "場面を追加" })).toBeNull();
  });
});

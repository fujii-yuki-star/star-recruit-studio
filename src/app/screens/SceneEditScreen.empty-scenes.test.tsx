// @vitest-environment jsdom
//
// 場面編集で場面が0になったとき（通し点検 2026-10-16）。
//
// ⚠️ **取り消しを重ねて場面が無くなると行き止まりだった**＝「新しい動画を作る」しか出ず、やり直す・場面を足す・
// たたき台へ戻るがマウスでは無かった（`Ctrl+Y` でしか戻れない＝§2-5）。
// ⚠️ **表示は共有の `NoScenesState`**（#590・ADR-0026②）＝作成中・失敗・入力の続きの見分けもそこに任せる。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { SceneEditScreen } from "./SceneEditScreen";
import { GENERATE_FAILED_TITLE } from "../uiLabels";

describe("SceneEditScreen 場面が0の動画", () => {
  const redo = vi.fn();
  const addScene = vi.fn(() => "scene_001");

  beforeEach(() => {
    redo.mockClear();
    addScene.mockClear();
    useProjectStore.setState({
      status: "ready",
      scenes: [], parts: [], assets: [], editingSceneId: null,
      past: [], future: [{} as never], _historyGroupDepth: 0, saveStatus: "saved",
      redo, addScene,
    });
  });

  it("場面を追加・やり直す・たたき台へを出す", () => {
    const onNavigate = vi.fn();
    render(<SceneEditScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "↷ やり直す" }));
    expect(redo).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "場面を追加" }));
    expect(addScene).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "たたき台へ" }));
    expect(onNavigate).toHaveBeenCalledWith("draft");
  });

  it("やり直せるものが無ければ「やり直す」は出さない", () => {
    useProjectStore.setState({ future: [] });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "↷ やり直す" })).toBeNull();
    expect(screen.getByRole("button", { name: "場面を追加" })).toBeTruthy();
  });

  it("動画案の作成に失敗したときは、共有の復帰の道を出す（場面を足せとは言わない）", () => {
    useProjectStore.setState({ status: "error", aiError: null });
    render(<SceneEditScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(GENERATE_FAILED_TITLE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "場面を追加" })).toBeNull();
  });
});

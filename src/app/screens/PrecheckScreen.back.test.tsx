// @vitest-environment jsdom
// 公開前チェックの「戻る」は、来た画面へ（#1026）。
//
// ⚠️ **戻る先が固定だった**＝入口は仕上がり確認と書き出しの2つなのに、戻るは常に
// 「場面編集へ戻る」で、**来ていない画面**を指していた（§2-5＝次の行動が実際と違う）。
// ⚠️ **仕上がり確認は前から入口を覚えている**（`previewReturnTo`）＝扱いが割れていた。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useProjectStore } from "../store/projectStore";
import { PrecheckScreen } from "./PrecheckScreen";
import type { ScreenId } from "../data/mockData";
import type { Scene } from "../../domain/project/types";

/** ⚠️ **場面が無いと空状態になり、戻るボタンごと出ない**（早い `return` の枝）。 */
const scene = (): Scene =>
  ({
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
  }) as Scene;

beforeEach(() => {
  vi.restoreAllMocks();
  useProjectStore.getState().setExportRun({ phase: "idle" });
  useProjectStore.getState().newProject();
  useProjectStore.setState({
    status: "ready",
    scenes: [scene()],
    parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
  });
});

const backButton = () => screen.getByRole("button", { name: /へ戻る/ });

describe("公開前チェックの戻る先（#1026）", () => {
  it.each([
    ["preview", "仕上がり確認へ戻る"],
    ["export", "書き出しへ戻る"],
  ])("%s から来たら、そこへ戻る", (from, label) => {
    useProjectStore.setState({ precheckReturnTo: from as ScreenId });
    const onNavigate = vi.fn();
    render(<PrecheckScreen onNavigate={onNavigate} />);
    expect(backButton().textContent).toContain(label);
    fireEvent.click(backButton());
    expect(onNavigate).toHaveBeenCalledWith(from);
  });

  // ⚠️ **知らない入口・未設定でも行き止まりにしない**＝順路の1つ手前（仕上がり確認）へ。
  it.each([null, "settings"])("知らない入口（%s）なら、順路の1つ手前へ", (from) => {
    cleanup();
    useProjectStore.setState({ precheckReturnTo: from as ScreenId | null });
    const onNavigate = vi.fn();
    render(<PrecheckScreen onNavigate={onNavigate} />);
    expect(backButton().textContent).toContain("仕上がり確認へ戻る");
    fireEvent.click(backButton());
    expect(onNavigate).toHaveBeenCalledWith("preview");
  });

  // ⚠️ **来ていない画面を指さない**＝これが元の穴（常に「場面編集へ戻る」だった）。
  it("来ていない画面（場面編集）は指さない", () => {
    useProjectStore.setState({ precheckReturnTo: "export" as ScreenId });
    render(<PrecheckScreen onNavigate={vi.fn()} />);
    expect(backButton().textContent, "来ていない画面を指している").not.toContain("場面編集");
  });
});

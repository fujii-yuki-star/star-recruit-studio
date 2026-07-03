// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { ProjectNameField } from "./ProjectNameField";

describe("ProjectNameField（#252 編集中の改名）", () => {
  beforeEach(() => {
    useProjectStore.setState({
      meta: { ...useProjectStore.getState().meta, projectName: "無題のプロジェクト" },
      past: [], future: [], _historyGroupDepth: 0, saveStatus: "saved",
    });
  });

  it("入力→確定（blur）で名前が store に反映され、未保存に戻る", () => {
    render(<ProjectNameField />);
    const input = screen.getByLabelText("動画の名前") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "採用動画2026" } });
    fireEvent.blur(input);
    expect(useProjectStore.getState().meta.projectName).toBe("採用動画2026");
    expect(useProjectStore.getState().saveStatus).toBe("idle");
  });

  it("空（空白のみ）で確定しても元の名前に戻る（空は保存しない）", () => {
    render(<ProjectNameField />);
    const input = screen.getByLabelText("動画の名前") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(useProjectStore.getState().meta.projectName).toBe("無題のプロジェクト");
    expect(input.value).toBe("無題のプロジェクト"); // 表示も元へ戻る
  });

  it("Enter で確定（blur 経由）＝改名は Undo で戻る（1改名=1履歴）", () => {
    render(<ProjectNameField />);
    const input = screen.getByLabelText("動画の名前") as HTMLInputElement;
    input.focus(); // 実フォーカス（activeElement 設定＝Enter の blur() が発火する）
    fireEvent.change(input, { target: { value: "会社紹介" } });
    fireEvent.keyDown(input, { key: "Enter" }); // → blur() → commit
    expect(useProjectStore.getState().meta.projectName).toBe("会社紹介");
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().meta.projectName).toBe("無題のプロジェクト");
  });
});

// @vitest-environment jsdom
// 書き出しに失敗した知らせに、**次の行動を置く**（#1032・§2-5）。
//
// 他画面向けの終了通知（`ExportResultNotice`・#589）は行動ボタンを持っているのに、
// **失敗を直に見ているこの画面だけが読むだけ**だった。直す入口（公開前チェック）も
// やり直す入口（動画を保存）も**遠く上にしかない**（進行バー・保存先の欄を挟むので画面外になりうる）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import type { Scene } from "../../domain/project/types";
import { ExportScreen } from "./ExportScreen";

function scene(over: Partial<Scene> = {}): Scene {
  return {
    sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
    character: { enabled: false, characterId: "yuko" }, texts: {},
    narration: { text: "", status: "none" }, warnings: [],
    ...over,
  } as Scene;
}

/** 失敗を**いま起きたこと**にする（描いてから落とす）。入った時点で失敗していると
 * 「前回の結果」扱いになり、読み上げを割り込まない（`role="status"`）≡ #547 P3-11。 */
function failNow(): void {
  act(() => {
    useProjectStore.getState().setExportRun({ phase: "error", message: FAIL_MESSAGE });
  });
}

const FAIL_MESSAGE = "動画を作れませんでした。もう一度お試しください。";

describe("ExportScreen 失敗の知らせに次の行動を置く（#1032）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene()], assets: [], status: "ready", saveStatus: "saved",
    });
  });

  it("失敗の知らせに「公開前チェックを開く」と「もう一度書き出す」が並ぶ", () => {
    render(<ExportScreen onNavigate={vi.fn()} />);
    failNow();
    const notice = screen.getByRole("alert");
    expect(notice.textContent).toContain(FAIL_MESSAGE);
    expect(notice.textContent).toContain("公開前チェックを開く");
    expect(notice.textContent).toContain("もう一度書き出す");
  });

  it("「公開前チェックを開く」は戻り先を覚えてから移る（来ていない画面を指さない・#1026）", () => {
    const onNavigate = vi.fn();
    render(<ExportScreen onNavigate={onNavigate} />);
    failNow();
    fireEvent.click(screen.getByRole("button", { name: "公開前チェックを開く" }));
    expect(onNavigate).toHaveBeenCalledWith("precheck");
    expect(useProjectStore.getState().precheckReturnTo).toBe("export");
  });

  it("やり直す側は上のボタンと同じ条件で押せなくなる（片方だけ塞がれていない、を作らない）", () => {
    // 書き出せない理由（見た目が見つからない場面）を作ると、上の「動画を保存」も
    // 知らせの中の「もう一度書き出す」も**同時に**押せなくなる。
    useProjectStore.setState({ scenes: [scene({ templateId: "missing_tmpl" })] });
    render(<ExportScreen onNavigate={vi.fn()} />);
    failNow();
    expect((screen.getByRole("button", { name: /動画を保存|書き出し中…/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "もう一度書き出す" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

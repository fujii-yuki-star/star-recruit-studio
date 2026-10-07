// @vitest-environment jsdom
// 左の帯（メニュー）を畳む・戻す（#1103）。
//
// ⚠️ **戻す道が消えないことが本丸**（ADR-0033 決定6/8）＝利用者は **(b) 完全に隠す**を選んだので、
// 隠したあとに戻れなくなると**アプリの行き先を全部失う**（一覧へも設定へも行けない）。
// だから「畳める」より先に「戻せる」を固定する。
//
// ⚠️ **キーボードで押せることは、押してみても確かめられない**（[[synthetic-events-limits]]）＝
// 合成イベントの `click` は焦点を移さないし `Tab` も動かない。**`<button>` で出していること**と
// **名前が付いていること**を見る（これが `Tab` で辿り着けて `Enter` で押せることの土台）。
// 実際に指で辿れるかは実機で見る。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "./App";
import { useProjectStore } from "./app/store/projectStore";
import {
  SIDEBAR_COLLAPSED_IN_EDITOR_DEFAULT,
  resetEditorSidebarCollapsedTo,
  resetSidebarCollapsedTo,
} from "./app/hooks/useSidebarCollapsed";
import { sampleTemplates } from "./infrastructure/sampleData";

const LS_KEY = "shell.sidebarCollapsed";

beforeEach(() => {
  useProjectStore.getState().setExportRun({ phase: "idle" });
  localStorage.clear();
  // ⚠️ **`localStorage.clear()` だけでは足りない**＝この場の正はモジュールの変数なので、
  // 消してもテストをまたいで残る。
  resetSidebarCollapsedTo(false);
  // ⚠️ **既定は定数から入れ直す**＝`true` と書くと、既定を `false` に戻す変異が生き残る。
  resetEditorSidebarCollapsedTo(SIDEBAR_COLLAPSED_IN_EDITOR_DEFAULT);
});

/** 左の帯そのもの（畳むと DOM から消える＝(b) 完全に隠す）。 */
const sidebar = (): HTMLElement | null => document.querySelector(".sidebar");
const collapseButton = (): HTMLElement => screen.getByRole("button", { name: "メニューを畳む" });
const revealButton = (): HTMLElement => screen.getByRole("button", { name: "メニューを出す" });

describe("左の帯を畳む（#1103）", () => {
  it("はじめは出ている", () => {
    render(<App />);
    expect(sidebar()).not.toBeNull();
    expect(screen.queryByRole("button", { name: "メニューを出す" })).toBeNull();
  });

  it("畳むと帯は消え、戻す取っ手が出る", () => {
    render(<App />);
    fireEvent.click(collapseButton());
    // (b)＝アイコンだけ残す形ではなく、帯ごと消える。
    expect(sidebar()).toBeNull();
    expect(revealButton()).toBeInTheDocument();
  });

  it("戻す取っ手を押すと、帯が戻る", () => {
    render(<App />);
    fireEvent.click(collapseButton());
    fireEvent.click(revealButton());
    expect(sidebar()).not.toBeNull();
    expect(screen.queryByRole("button", { name: "メニューを出す" })).toBeNull();
  });

  it("戻す取っ手は、キーボードで押せる形で出す", () => {
    // ⚠️ **掴む操作しか無い戻り方を作らない**＝`<button>` であることと、名前が付いていることを見る。
    render(<App />);
    fireEvent.click(collapseButton());
    const handle = revealButton();
    expect(handle.tagName).toBe("BUTTON");
    expect(handle).not.toBeDisabled();
    // 押せば戻る（名前だけあって何も起きない、を作らない）。
    fireEvent.click(handle);
    expect(sidebar()).not.toBeNull();
  });

  // ⚠️ **ここで「開き直しても畳んだまま」とは名乗らない**＝この検査が確かめているのは
  // 「覚えに書いた」ことと「画面を描き直しても保つ」ことまで。**覚えを読み直す所は通っていない**
  // （読むのはモジュールが読み込まれた1回だけなので、`render` を繰り返しても走らない）。
  // 実際、最初はこれを「開き直しても」と名乗っていて、**読み取りをやめる変異が生き残った**。
  // 読み取りそのものは `src/app/hooks/booleanPref.test.ts` が直に叩いて留めている。
  it("畳んだことを覚えに書き、描き直しても畳んだまま", () => {
    const first = render(<App />);
    fireEvent.click(collapseButton());
    expect(localStorage.getItem(LS_KEY)).toBe("1");
    first.unmount();

    render(<App />);
    expect(sidebar()).toBeNull();
    expect(revealButton()).toBeInTheDocument();
  });

  it("出し直したことも覚えに書く", () => {
    const first = render(<App />);
    fireEvent.click(collapseButton());
    fireEvent.click(revealButton());
    expect(localStorage.getItem(LS_KEY)).toBe("0");
    first.unmount();

    render(<App />);
    expect(sidebar()).not.toBeNull();
  });

  it("覚えられなくても、その場では畳める", () => {
    // ⚠️ **押せるのに何も起きない、を作らない**（§2-5）＝プライベートモード等で保存に失敗しても、
    // この場の正はモジュールの変数なので効く（次に開いたときは既定へ戻る）。
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("保存できない");
    });
    try {
      render(<App />);
      fireEvent.click(collapseButton());
      expect(sidebar()).toBeNull();
      expect(revealButton()).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });
});

// 編集画面では**畳んだ状態で始める**（ADR-0048・#1256 b1）＝作業場を最大にする。
// ⚠️ **覚えは編集画面の外と別**＝一覧で出したら編集画面でも出たまま、を作らない。
describe("左の帯：編集画面では畳んで始める（#1256 b1）", () => {
  const EDITOR_KEY = "shell.sidebarCollapsedInEditor";
  beforeEach(() => {
    useProjectStore.getState().newProject();
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [{
        sceneId: "scene_001", partId: "part_001", order: 1, sceneType: "photo_intro",
        templateId: "photo_left_text_right_yuko_v1", durationSec: 8, assetRefs: {},
        character: { enabled: false, characterId: "yuko" }, texts: {}, narration: { text: "", status: "none" }, warnings: [],
      }],
      status: "ready",
      saveStatus: "saved",
    });
  });
  /** 一覧（帯が出ている所）から場面編集へ入る。 */
  const enterSceneEdit = (container: HTMLElement): void => {
    fireEvent.click(within(container.querySelector(".sidebar") as HTMLElement).getByText("今の動画").closest("button")!);
    fireEvent.click(within(container).getByText("この内容で確認・編集する").closest("button")!);
    expect(within(container).getByText("台本表へ戻る")).toBeInTheDocument();
  };

  it("編集画面に入ると畳まれ、戻す取っ手が出る（外では出ていた）", () => {
    const { container } = render(<App />);
    expect(sidebar(), "編集画面の外で畳まれている").not.toBeNull();
    enterSceneEdit(container);
    expect(sidebar(), "編集画面で帯が出たまま").toBeNull();
    expect(revealButton()).toBeInTheDocument();
  });

  it("編集画面で出したら、それを編集画面の覚えにだけ書く（外の覚えは変えない）", () => {
    const { container } = render(<App />);
    enterSceneEdit(container);
    fireEvent.click(revealButton());
    expect(sidebar()).not.toBeNull();
    expect(localStorage.getItem(EDITOR_KEY)).toBe("0");
    expect(localStorage.getItem(LS_KEY), "外の覚えまで書き換えた").toBeNull();
  });

  it("外で畳んでも、編集画面の覚えは変わらない（別々に覚える）", () => {
    const { container } = render(<App />);
    enterSceneEdit(container);
    fireEvent.click(revealButton()); // 編集画面では出す
    fireEvent.click(within(container.querySelector(".sidebar") as HTMLElement).getByText("素材").closest("button")!);
    fireEvent.click(collapseButton()); // 外では畳む
    expect(localStorage.getItem(LS_KEY)).toBe("1");
    expect(localStorage.getItem(EDITOR_KEY), "外で畳んだら編集画面の覚えも変わった").toBe("0");
  });
});

it("編集画面に数えるのは、場面編集・タイムライン編集・見た目パターン編集の3つ", async () => {
  const { SIDEBAR_EDITOR_SCREENS } = await import("./app/hooks/useSidebarCollapsed");
  expect([...SIDEBAR_EDITOR_SCREENS].sort()).toEqual(["looks-edit", "scene-edit", "timeline-project"]);
});

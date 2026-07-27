// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { sampleTemplates } from "../../infrastructure/sampleData";
import { DraftScreen } from "./DraftScreen";
import { GeneratingScreen } from "./GeneratingScreen";
import { ExportScreen } from "./ExportScreen";
import { PrecheckScreen } from "./PrecheckScreen";
import { PreviewScreen } from "./PreviewScreen";

// #590：「場面がまだ無い」ときの表示が公開前チェック／仕上がり確認／書き出し／たたき台でバラバラだった
// （共有コンポーネントの有無・次の行動の破壊/非破壊・status を見るか否か）。
// **1画面だけ直しても落ちる**形で固定する＝共有をやめて手書きに戻すと、この describe が赤くなる（ADR-0026②）。

/** 場面を作れない下流3画面（ここでの次の行動は「場面を作れる画面へ送る」で揃っているべき）。 */
const DOWNSTREAM: { name: string; render: (nav: (s: ScreenId) => void) => React.ReactElement }[] = [
  { name: "公開前チェック", render: (nav) => <PrecheckScreen onNavigate={nav} /> },
  { name: "仕上がり確認", render: (nav) => <PreviewScreen onNavigate={nav} /> },
  { name: "書き出し", render: (nav) => <ExportScreen onNavigate={nav} /> },
];

function setup(over: Partial<ReturnType<typeof useProjectStore.getState>> = {}) {
  useProjectStore.getState().setExportRun({ phase: "idle" });
  useProjectStore.getState().newProject(); // 場面ゼロのクリーン状態（status "idle"）
  useProjectStore.setState({ templates: sampleTemplates, parts: [], scenes: [], saveStatus: "saved", ...over });
}

describe("場面ゼロの空状態は4画面で揃う（#590）", () => {
  beforeEach(() => setup());

  it("動画案はあるが場面が0＝どの画面も同じ見出しで、同じ「場面を作れる画面へ」を出す", () => {
    for (const s of DOWNSTREAM) {
      setup({ status: "ready" });
      const nav = vi.fn();
      const view = render(s.render(nav));
      expect(screen.getByText("まだ場面がありません"), s.name).toBeTruthy();
      fireEvent.click(screen.getByText("たたき台へ"));
      expect(nav, s.name).toHaveBeenCalledWith("draft");
      // 素材・会社情報は残っているので、空状態から**今の内容を捨てる**導線は出さない（非破壊に揃える）。
      expect(screen.queryByText("新しい動画を作る"), s.name).toBeNull();
      view.unmount();
    }
  });

  it("まだ何も無い（動画案が未作成）＝どの画面も同じ見出しで「新しい動画を作る」", () => {
    for (const s of DOWNSTREAM) {
      setup({ status: "idle" });
      const nav = vi.fn();
      const view = render(s.render(nav));
      expect(screen.getByText("まだ動画案がありません"), s.name).toBeTruthy();
      fireEvent.click(screen.getByText("新しい動画を作る"));
      expect(nav, s.name).toHaveBeenCalledWith("wizard");
      view.unmount();
    }
  });

  // 以前はたたき台だけが status を見ていた＝生成に失敗しても他3画面は「まだ場面がありません」としか出さず、
  // 理由も次の行動も分からなかった（§2-5）。
  it("作成に失敗したときは、たたき台を含む4画面すべてが理由と復帰の2択を出す", () => {
    for (const s of [...DOWNSTREAM, { name: "たたき台", render: (nav: (x: ScreenId) => void) => <DraftScreen onNavigate={nav} /> }]) {
      setup({ status: "error", aiError: "AIの応答を読み取れませんでした。" });
      const nav = vi.fn();
      const view = render(s.render(nav));
      expect(screen.getByText("動画案の作成に失敗しました"), s.name).toBeTruthy();
      expect(screen.getByText("AIの応答を読み取れませんでした。"), s.name).toBeTruthy(); // 理由
      fireEvent.click(screen.getByText("もう一度試す"));
      expect(nav, s.name).toHaveBeenCalledWith("generating");
      // 手動リカバリ（#393 P1）＝どの画面から入っても同じ（status を ready にしてたたき台へ）。
      fireEvent.click(screen.getByText("手動で場面を作る"));
      expect(useProjectStore.getState().status, s.name).toBe("ready");
      expect(nav, s.name).toHaveBeenCalledWith("draft");
      view.unmount();
    }
  });

  it("作成中はどの下流画面も「作成中」と伝える（「場面がありません」と言い切らない）", () => {
    for (const s of DOWNSTREAM) {
      setup({ status: "generating" });
      const view = render(s.render(vi.fn()));
      expect(screen.getByText("動画案を作成中です…"), s.name).toBeTruthy();
      expect(screen.queryByText("まだ場面がありません"), s.name).toBeNull();
      // 待つしかない状態なので、下流画面からは「場面を作れる画面へ」だけを出す（作れないものを勧めない）。
      expect(screen.getByText("たたき台へ"), s.name).toBeTruthy();
      view.unmount();
    }
  });

  // たたき台は「たたき台へ」を出せない（自分自身）。作成中は場面も足せない（できあがりを上書きしてしまう）＝
  // ボタンなしで待たせる分岐。`NoScenesState` で唯一 action が undefined になるところなので固定する（PR #615 レビュー）。
  it("たたき台の作成中はボタンを出さず待たせる（自分の画面へ送り返さない・作りかけに足させない）", () => {
    setup({ status: "generating" });
    const { container } = render(<DraftScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("動画案を作成中です…")).toBeTruthy();
    expect(screen.queryByText("たたき台へ")).toBeNull();
    expect(screen.queryByText("場面を追加")).toBeNull();
    expect(screen.queryByText("新しい動画を作る")).toBeNull();
    // 空状態のカード内にボタンが1つも無いこと（上のヘッダ等のボタンと取り違えない）。
    const card = container.querySelector(".card") as HTMLElement;
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
  });

  // 生成中の画面と空状態は**同じ言葉**で失敗を伝える（挙動は同じなのにラベルだけ割れる、を防ぐ・§6・PR #615 レビュー）。
  it("生成中の画面の失敗表示も、空状態と同じ見出し・説明・2択のラベルを使う", () => {
    setup({ status: "idle" });
    const view = render(<GeneratingScreen onNavigate={vi.fn()} />);
    // この画面はマウント時に生成を始める（status が "generating" になる）ので、失敗表示は生成後に落として出す。
    act(() => {
      useProjectStore.setState({ status: "error", aiError: "AIの応答を読み取れませんでした。" });
    });
    expect(screen.getByText("動画案の作成に失敗しました")).toBeTruthy();
    expect(screen.getByText("AIの応答を読み取れませんでした。")).toBeTruthy();
    expect(screen.getByText("もう一度試す")).toBeTruthy();
    expect(screen.getByText("手動で場面を作る")).toBeTruthy();
    view.unmount();

    // 空状態（下流画面）も同じ言葉。片方だけ文言を変えるとここが落ちる。
    setup({ status: "error", aiError: "AIの応答を読み取れませんでした。" });
    render(<ExportScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("動画案の作成に失敗しました")).toBeTruthy();
    expect(screen.getByText("もう一度試す")).toBeTruthy();
    expect(screen.getByText("手動で場面を作る")).toBeTruthy();
  });

  // たたき台だけは**その画面で場面を作れる**ので、次の行動が「場面を追加」になる（自分の画面へ送り返さない）。
  it("たたき台は自分で場面を作れるので「場面を追加」を出す（たたき台へ、ではない）", () => {
    setup({ status: "ready" });
    const { container } = render(<DraftScreen onNavigate={vi.fn()} />);
    expect(screen.getByText("場面を追加して作り始めましょう")).toBeTruthy();
    fireEvent.click(within(container).getByText("場面を追加"));
    expect(useProjectStore.getState().scenes.length).toBe(1);
    expect(screen.queryByText("たたき台へ")).toBeNull();
  });
});

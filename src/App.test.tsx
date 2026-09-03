// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor, within } from "@testing-library/react";
import App from "./App";
import { useProjectStore } from "./app/store/projectStore";
import { sampleTemplates } from "./infrastructure/sampleData";
import * as fsMod from "./infrastructure/projectFs";
import { TIMELINE_SCHEMA_VERSION } from "./domain/timeline/types";
import type { Scene } from "./domain/project/types";
import { registerNavigationGuardForTest } from "./app/hooks/navigationGuard";

// #547 P3-7 レビュー：navigation.ts の単体テストと Sidebar の props テストの"接着"＝App 側の配線
// （navigate が projectReturnTo を更新 → Sidebar の currentProjectTarget → 実クリック遷移）を統合で固定する。
// これが無いと、App.tsx の結線が崩れても両単体テストは緑のまま（レビュー指摘）。
function scene(id: string, order: number): Scene {
  return {
    sceneId: id,
    partId: "part_001",
    order,
    sceneType: "photo_intro",
    templateId: "photo_left_text_right_yuko_v1",
    durationSec: 8,
    assetRefs: {},
    character: { enabled: false, characterId: "yuko" },
    texts: {},
    narration: { text: "", status: "none" },
    warnings: [],
  };
}

/** サイドバー内に限定してボタンを押す（場面編集など本文にも「素材」等が出るため、ナビと取り違えない）。 */
function clickSidebar(container: HTMLElement, label: string) {
  const sidebar = container.querySelector(".sidebar") as HTMLElement;
  fireEvent.click(within(sidebar).getByText(label).closest("button")!);
}

describe("App「今の動画」の戻り先の配線（#547 P3-7 統合）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene("scene_001", 1)],
      status: "ready",
      saveStatus: "saved",
    });
  });

  it("工程画面（場面編集）へ入って工程外（素材）へ出ても、「今の動画」で場面編集に戻る（たたき台固定にしない）", () => {
    const { container } = render(<App />);

    // 動画を開いている＝サイドバーに「今の動画」が出る。押すと既定の戻り先＝たたき台。
    clickSidebar(container, "今の動画");
    expect(container.querySelector(".sidebar")).not.toBeNull();
    // たたき台の固有ボタン。
    expect(within(container).getByText("この内容で確認・編集する")).toBeInTheDocument();

    // たたき台 → 場面編集（工程内の移動＝戻り先が draft から scene-edit へ更新される）。
    fireEvent.click(within(container).getByText("この内容で確認・編集する").closest("button")!);
    expect(within(container).getByText("台本表へ戻る")).toBeInTheDocument(); // 場面編集に居る

    // 工程外（素材）へ出る。
    clickSidebar(container, "素材");
    expect(within(container).queryByText("台本表へ戻る")).toBeNull(); // 場面編集を離れた
    // 「素材を管理」はトップバー見出し＋本文見出しで2箇所に出るため、トップバーで確定する（工程外＝独自ヘッダ無し）。
    expect((container.querySelector(".topbar-title") as HTMLElement).textContent).toBe("素材を管理");

    // 「今の動画」＝直近の工程画面（場面編集）へ戻る。たたき台へは飛ばない。
    clickSidebar(container, "今の動画");
    expect(within(container).getByText("台本表へ戻る")).toBeInTheDocument(); // 場面編集へ復帰
    expect(within(container).queryByText("この内容で確認・編集する")).toBeNull(); // たたき台ではない
  });

  it("まだ工程画面に入っていなければ、「今の動画」は入口＝たたき台へ（既定の戻り先）", () => {
    const { container } = render(<App />);
    // 一覧（home）から直接。工程画面は未訪問＝既定の draft。
    clickSidebar(container, "今の動画");
    expect(within(container).getByText("この内容で確認・編集する")).toBeInTheDocument();
  });
});

// #589：書き出しの終了通知は**どの画面にいても**出す（書き出し画面だけ除く＝そこに結果がある）。
// 判定・文言の単体テストだけでは「App のどこに置いたか（独自ヘッダ画面で消えていないか・書き出し画面で二重に出ないか）」を
// 保証できないため、実 App で配線を固定する（#563 で domain を直しても画面に出なかった教訓）。
describe("App 書き出しの終了通知の配線（#589 統合）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    useProjectStore.setState({
      templates: sampleTemplates,
      parts: [{ partId: "part_001", title: "パート1", order: 1, sceneIds: ["scene_001"] }],
      scenes: [scene("scene_001", 1)],
      status: "ready",
      saveStatus: "saved",
    });
  });

  it("他画面（たたき台）にいるときに終わったら通知が出る", () => {
    const { container } = render(<App />);
    clickSidebar(container, "今の動画"); // → たたき台
    act(() => {
      useProjectStore.getState().setExportRun({ phase: "done" });
    });
    expect(within(container).getByText(/動画の書き出しが終わりました/)).toBeInTheDocument();
  });

  it("独自ヘッダの画面（場面編集）でも消えない＝待っている人にこそ必要", () => {
    const { container } = render(<App />);
    clickSidebar(container, "今の動画");
    fireEvent.click(within(container).getByText("この内容で確認・編集する").closest("button")!);
    expect(within(container).getByText("台本表へ戻る")).toBeInTheDocument(); // 場面編集（独自ヘッダ）
    act(() => {
      useProjectStore.getState().setExportRun({ phase: "error", message: "失敗の理由" });
    });
    expect(within(container).getByText(/書き出しに失敗しました/)).toBeInTheDocument();
  });

  it("書き出し画面では出さず、開いた時点で既読になる（他画面へ戻っても再び出ない）", () => {
    const { container } = render(<App />);
    act(() => {
      useProjectStore.getState().setExportRun({ phase: "done" });
    });
    // 通知の「書き出しの画面へ」で移動＝そこに結果があるので通知は出さない。
    fireEvent.click(within(container).getByRole("button", { name: "書き出しの画面へ" }));
    expect(within(container).queryByText(/動画の書き出しが終わりました/)).toBeNull();
    expect(useProjectStore.getState().exportRun.resultUnseen).toBe(false); // 既読になった
    // 他画面へ戻っても再掲しない（#547 P3-11 の「古い通知が残る」を作らない）。
    clickSidebar(container, "素材");
    expect(within(container).queryByText(/動画の書き出しが終わりました/)).toBeNull();
  });
});

// ADR-0032：タイムライン編集は**別の文書**。共通トップバーの「保存」は場面形式（projectStore）を保存するので、
// この画面には出さない（見ている文書と違うものが保存される／場面文書が無いと空のプロジェクトが新しく作られる）。
describe("タイムライン編集の画面には場面形式の保存バーを出さない（#629 /canon-check 🔴）", () => {
  const timelineDoc = {
    schemaVersion: TIMELINE_SCHEMA_VERSION,
    format: "timeline",
    projectId: "proj_20260728_001",
    projectName: "焼いた動画",
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    videoSettings: { aspectRatio: "16:9", fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: "voicevox_zundamon" },
    assets: [],
    tracks: [{ id: "track_001", kind: "visual" }],
    clips: [],
  };

  it("一覧から開くと専用画面になり、共通トップバー（保存・保存状態）が出ない", async () => {
    useProjectStore.setState({ templates: sampleTemplates, scenes: [], parts: [], assets: [] });
    vi.spyOn(fsMod, "listProjectSummaries").mockResolvedValue([
      { projectId: "proj_20260728_001", projectName: "焼いた動画", updatedAt: "2026-07-28T00:00:00.000Z", format: "timeline" },
    ]);
    vi.spyOn(fsMod, "loadProjectDoc").mockResolvedValue(JSON.stringify(timelineDoc));

    const { container, findByText } = render(<App />);
    expect(container.querySelector(".topbar")).not.toBeNull(); // 一覧では出ている
    fireEvent.click(await findByText("焼いた動画"));
    await waitFor(() => expect(container.querySelector(".topbar")).toBeNull());
  });
});

// #719：離れる前の関門（`navigationGuard`）が **App の `navigate` に繋がっている**ことを固定する。
// これが無いと、関門そのものの単体テストと画面側のテストが両方緑でも、**繋がっていなければ素通し**になる
// （実際、サイドバーからの離脱がその状態だった）。
describe("App の遷移が離れる前の関門を通る（#719 統合）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    useProjectStore.setState({ templates: sampleTemplates, status: "ready", saveStatus: "saved" });
  });

  it("関門が断ったら、サイドバーを押しても画面が変わらない", () => {
    const seen: string[] = [];
    // 「離れないでほしい」と名乗っている状態を作る（実際に名乗るのはタイムライン編集画面）。
    const release = registerNavigationGuardForTest((to) => { seen.push(to); return false; });
    try {
      const { container } = render(<App />);
      clickSidebar(container, "素材");
      expect(seen).toEqual(["materials"]); // 行き先は関門へ渡る
      // 断られたので画面は変わらない（素材画面の見出しが出ていない）。
      expect(container.textContent).not.toContain("素材を管理");
    } finally {
      release();
    }
  });

  it("関門が許せば、これまでどおり移れる", () => {
    const release = registerNavigationGuardForTest(() => true);
    try {
      const { container } = render(<App />);
      clickSidebar(container, "素材");
      expect(container.textContent).toContain("素材を管理");
    } finally {
      release();
    }
  });
});

/**
 * 持ち込みフォントは**起動時に1回そろえる**（α-6 出口監査 🟡11）。
 *
 * ⚠️ `loadUserFonts` の入口が設定・公開前チェック・書き出しにしか無く、**場面編集・仕上がり確認・
 * タイムライン編集ではプレビューだけ既定の字体**になっていた（書き出しは実物＝ADR-0001 が崩れる）。
 * 画面ごとに数え上げると必ず漏れるので、**文書より上の起点で1回**通す。
 */
describe("持ち込みフォントを起動時に読み込む（α-6 出口監査 🟡11）", () => {
  it("App を開いた時点で refreshUserFonts が呼ばれる", async () => {
    const refreshUserFonts = vi.fn(async () => {});
    useProjectStore.setState({ refreshUserFonts } as never);
    render(<App />);
    await waitFor(() => expect(refreshUserFonts).toHaveBeenCalled());
  });

  /** ⚠️ **読めなくても画面は開く**（同梱の字体は使えるので行き止まりにしない）。 */
  it("読み込みに失敗しても画面は出る", async () => {
    const refreshUserFonts = vi.fn(async () => {
      throw new Error("読めません");
    });
    useProjectStore.setState({ refreshUserFonts } as never);
    const { container } = render(<App />);
    await waitFor(() => expect(refreshUserFonts).toHaveBeenCalled());
    expect(container.querySelector(".sidebar")).toBeTruthy();
  });
});

// サイドバーの「今の動画」も同じ判定（`hasOpenProject`）から採る（差分再監査 6・7巡目 🟡）。
//
// ⚠️ **同じ問いを画面ごとに書き直さない**＝棚からの取り込み・「素材を追加」・会社の見た目の反映と
// 同じ式。1つの条件だけで見ると、白紙から作った直後やウィザードの途中を取りこぼす。
describe("App「今の動画」を出すかの判定", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    useProjectStore.setState({ templates: sampleTemplates, parts: [], scenes: [], saveStatus: "saved" });
  });

  it("何も開いていなければ出さない", () => {
    const { container } = render(<App />);
    expect(within(container).queryByText("今の動画")).toBeNull();
  });

  it("白紙から作った直後（番号なし・場面なし）でも出す", () => {
    useProjectStore.setState({ status: "ready" });
    const { container } = render(<App />);
    expect(within(container).getByText("今の動画")).toBeInTheDocument();
  });

  it("ウィザードの途中（会社名だけ入れた状態）でも出す", () => {
    const meta = useProjectStore.getState().meta;
    useProjectStore.setState({ meta: { ...meta, companyInfo: { ...meta.companyInfo, companyName: "すたりお商事" } } } as never);
    const { container } = render(<App />);
    expect(within(container).getByText("今の動画")).toBeInTheDocument();
  });
});

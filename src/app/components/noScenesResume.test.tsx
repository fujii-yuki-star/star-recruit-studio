// @vitest-environment jsdom
// **保存した動画からウィザードの続きへ戻れる**（#985）。
//
// ⚠️ **元の行き止まり**＝ウィザードで「ここまで保存」した動画を開き直すと、
// たたき台の空状態で「場面を追加」しか出ず、**たたき台を作る道も、入れた会社情報を直す道も無かった**。
// ウィザードへ行く導線はアプリ全体で1本だけで、それは必ず `newProject()` で**中身を捨てる**。
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NoScenesState } from "./NoScenesState";
import { useProjectStore } from "../store/projectStore";
import { EDIT_WIZARD_INPUT_LABEL, REGENERATE_OVERWRITE_CONFIRM, RESUME_WIZARD_LABEL } from "../uiLabels";

const withMeta = (meta: Record<string, unknown>) =>
  useProjectStore.setState({
    status: "ready",
    scenes: [],
    meta: { ...useProjectStore.getState().meta, ...meta },
  } as never);

describe("場面が0のとき、入力の続きへ戻れる（#985）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("会社名を入れて保存した動画には、続きへ戻る導線が出る", () => {
    withMeta({ companyInfo: { companyName: "株式会社テスト" } });
    const onNavigate = vi.fn();
    render(<NoScenesState purpose="ここで場面を作ります" onNavigate={onNavigate} onAddScene={vi.fn()} />);
    fireEvent.click(screen.getByText(RESUME_WIZARD_LABEL));
    expect(onNavigate).toHaveBeenCalledWith("wizard");
  });

  it("一般・社内発表（テーマだけ入れた）でも出る", () => {
    withMeta({ companyInfo: undefined, generalBrief: { title: "社内発表" } });
    render(<NoScenesState purpose="ここで場面を作ります" onNavigate={vi.fn()} onAddScene={vi.fn()} />);
    expect(screen.getByText(RESUME_WIZARD_LABEL)).toBeInTheDocument();
  });

  it("何も入れていない動画には出さない（行き先が空なので）", () => {
    withMeta({ companyInfo: undefined, generalBrief: undefined });
    render(<NoScenesState purpose="ここで場面を作ります" onNavigate={vi.fn()} onAddScene={vi.fn()} />);
    expect(screen.queryByText(RESUME_WIZARD_LABEL)).toBeNull();
  });

  it("手で場面を作る道も残す（続きが出ても消さない）", () => {
    // ⚠️ **片方を主にしただけ**＝手動の道を消すと、ウィザードを使わない人が行き止まりになる。
    withMeta({ companyInfo: { companyName: "株式会社テスト" } });
    const onAddScene = vi.fn();
    render(<NoScenesState purpose="ここで場面を作ります" onNavigate={vi.fn()} onAddScene={onAddScene} />);
    fireEvent.click(screen.getByText("場面を追加"));
    expect(onAddScene).toHaveBeenCalled();
  });

  it("場面を足せない画面（仕上がり確認など）では、これまでどおり", () => {
    // `onAddScene` を渡さない画面は「たたき台へ」だけ＝ここは変えない。
    withMeta({ companyInfo: { companyName: "株式会社テスト" } });
    render(<NoScenesState purpose="ここで場面を作ります" onNavigate={vi.fn()} />);
    expect(screen.queryByText(RESUME_WIZARD_LABEL)).toBeNull();
  });
});

// ⚠️ **行った先で入力が残っているか**まで見る（#985）＝
// 導線があっても、着いた先が空なら**直したことにならない**。
describe("続きへ行っても、入れた内容は消えない（#985）", () => {
  it("ウィザードへ移っても `meta` はそのまま（`newProject` を通らない）", () => {
    withMeta({ companyInfo: { companyName: "株式会社テスト", industry: "製造" } });
    const before = useProjectStore.getState().meta;
    const onNavigate = vi.fn();
    render(<NoScenesState purpose="ここで場面を作ります" onNavigate={onNavigate} onAddScene={vi.fn()} />);
    fireEvent.click(screen.getByText(RESUME_WIZARD_LABEL));
    // ⚠️ **画面を変えるだけ**＝ここで store を触ると、入れた内容が消える。
    expect(useProjectStore.getState().meta).toBe(before);
    expect(useProjectStore.getState().meta.companyInfo?.companyName).toBe("株式会社テスト");
  });

  it("ウィザードは、その内容を初期値として読む", async () => {
    // ⚠️ **着いた先が空でないこと**を、ウィザード自身で確かめる。
    withMeta({ companyInfo: { companyName: "株式会社テスト", industry: "製造" }, videoKind: "recruit" });
    // ⚠️ **会社名は2段目**（1段目は用途の選択）＝保存した段から開く。
    useProjectStore.setState({ wizardStep: 1 } as never);
    const { WizardScreen } = await import("../screens/WizardScreen");
    render(<WizardScreen onNavigate={vi.fn()} />);
    expect((screen.getByDisplayValue("株式会社テスト") as HTMLInputElement).value).toBe("株式会社テスト");
  });
});

// ⚠️ **場面ができた後も、入れた内容へ戻れる**（#985）＝
// ウィザードは「会社情報は、あとからでも直せます」と案内しているのに、**指す先がどこにも無かった**
//（`06 §12.1`＝案内の中で名指しするものは、その画面に実在すること）。
describe("たたき台からも、入れた内容へ戻れる（#985）", () => {
  const scene = (id: string) =>
    ({ sceneId: id, partId: "part_001", order: 1, sceneType: "opening", templateId: "corp_title",
       durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
       narration: { text: "", voiceId: null, status: "none" }, warnings: [] }) as never;

  it("場面があるときも、見直す導線が出る", async () => {
    useProjectStore.setState({
      status: "ready",
      scenes: [scene("scene_001")],
      parts: [{ partId: "part_001", order: 1, title: "本編", sceneIds: ["scene_001"] }],
      meta: { ...useProjectStore.getState().meta, companyInfo: { companyName: "株式会社テスト" } },
    } as never);
    const { DraftScreen } = await import("../screens/DraftScreen");
    const onNavigate = vi.fn();
    render(<DraftScreen onNavigate={onNavigate} />);
    fireEvent.click(screen.getByText(EDIT_WIZARD_INPUT_LABEL));
    expect(onNavigate).toHaveBeenCalledWith("wizard");
  });

  it("白紙から作った動画には出さない（行き先が無い）", async () => {
    useProjectStore.setState({
      status: "ready",
      scenes: [scene("scene_001")],
      parts: [{ partId: "part_001", order: 1, title: "本編", sceneIds: ["scene_001"] }],
      meta: { ...useProjectStore.getState().meta, companyInfo: undefined, generalBrief: undefined },
    } as never);
    const { DraftScreen } = await import("../screens/DraftScreen");
    render(<DraftScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(EDIT_WIZARD_INPUT_LABEL)).toBeNull();
  });
});

// ⚠️ **作り直すと、いまの場面は入れ替わる**（#985 レビュー 🔴）。
// もとはたたき台の「作り直す」にしか確認が無く、**入れた内容を見直す道（#985）を通ると
// 場面が黙って消えた**＝行き止まりを直して**別の穴を開けた**形だった。
describe("作る手前で、上書きになることを告げる（#985 レビュー 🔴）", () => {
  const scene = (id: string) =>
    ({ sceneId: id, partId: "part_001", order: 1, sceneType: "opening", templateId: "corp_title",
       durationSec: 8, assetRefs: {}, character: { enabled: false, characterId: "yuko" }, texts: {},
       narration: { text: "", voiceId: null, status: "none" }, warnings: [] }) as never;

  it("場面があるときは、送信前確認で上書きになると告げる", async () => {
    useProjectStore.setState({
      scenes: [scene("scene_001")],
      meta: { ...useProjectStore.getState().meta, companyInfo: { companyName: "株式会社テスト" } },
    } as never);
    const { ConfirmScreen } = await import("../screens/ConfirmScreen");
    render(<ConfirmScreen onNavigate={vi.fn()} />);
    expect(screen.getByText(REGENERATE_OVERWRITE_CONFIRM)).toBeInTheDocument();
  });

  it("場面が無ければ告げない（消えるものが無い）", async () => {
    useProjectStore.setState({
      scenes: [],
      meta: { ...useProjectStore.getState().meta, companyInfo: { companyName: "株式会社テスト" } },
    } as never);
    const { ConfirmScreen } = await import("../screens/ConfirmScreen");
    render(<ConfirmScreen onNavigate={vi.fn()} />);
    expect(screen.queryByText(REGENERATE_OVERWRITE_CONFIRM)).toBeNull();
  });

  it("たたき台の確認と、同じ文を使う（片方だけ変わらない）", async () => {
    // ⚠️ **文言は1か所**＝2か所に書くと、片方だけ直って言うことが割れる。
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const f of ["ConfirmScreen.tsx", "DraftScreen.tsx"]) {
      const src = readFileSync(join(process.cwd(), "src", "app", "screens", f), "utf8");
      expect(src, `${f} が共有の文を使っていない`).toContain("REGENERATE_OVERWRITE_CONFIRM");
    }
  });
});

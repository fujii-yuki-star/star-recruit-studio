// @vitest-environment jsdom
// 「採用動画」は拡張パックの鍵 `recruit-video` で出す（ADR-0076）。
//
// - 決定2：鍵が無いと、新しく採用動画を作る入口（種類の選択）を出さない。目的は一般の4つだけ。
// - 決定3：鍵が無くても、以前に作った採用動画は見直せる（採用が選ばれて開く・会社情報が残る・切り替えて戻せる）。
// - 決定5：鍵があっても一般が先で、最初から一般が選ばれている。
// - 決定6：一般では採用の言葉を出さない（**画面まるごと**で探す＝文言ごとに書き並べると、直し漏れた1か所を見つけられない・CLAUDE.md §7）。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { WizardScreen } from "./WizardScreen";
import { WIZARD_STEP, wizardVideoKinds } from "./wizardSteps";
import { useProjectStore } from "../store/projectStore";
import { GENERAL_PURPOSES, VIDEO_KIND } from "../../domain/enums";
import { generalPurposeOptions } from "../data/mockData";
import { VIDEO_KIND_LABEL } from "../uiLabels";
import { openAsRecruitVideo, setRecruitVideoKey } from "../../test/recruitVideo";

/** 採用動画にしか出してはいけない言葉（ADR-0076 決定6）。 */
const RECRUIT_WORDS = ["採用", "求職", "会社"];

/** 画面に見えている文字（本文＋入力の例・読み上げ名・ホバーの説明）。 */
function visibleText(): string {
  const attrs = Array.from(document.querySelectorAll("[placeholder], [aria-label], [title]")).flatMap((el) =>
    ["placeholder", "aria-label", "title"].map((a) => el.getAttribute(a) ?? ""),
  );
  return [document.body.textContent ?? "", ...attrs].join("\n");
}

const kindGroup = () => screen.queryByTestId("wizard-video-kinds");

beforeEach(() => {
  useProjectStore.getState().setExportRun({ phase: "idle" });
  useProjectStore.getState().newProject();
  useProjectStore.setState({ wizardStep: 0 });
  setRecruitVideoKey(false);
});
afterEach(() => {
  cleanup();
  setRecruitVideoKey(false); // 鍵を後の検査へ持ち越さない
});

describe("鍵が無い（ADR-0076 決定2）", () => {
  it("新しい動画では種類の選択を出さず、目的は一般の4つだけ・一般の先頭が選ばれている", () => {
    render(<WizardScreen onNavigate={() => {}} />);
    expect(kindGroup(), "種類の選択が出ている").toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(VIDEO_KIND_LABEL[VIDEO_KIND.recruit]) })).toBeNull();
    for (const o of generalPurposeOptions) expect(screen.getByRole("button", { name: new RegExp(o.label) })).toBeTruthy();
    const first = generalPurposeOptions.find((o) => o.id === GENERAL_PURPOSES[0])!;
    expect(screen.getByRole("button", { name: new RegExp(first.label), pressed: true })).toBeTruthy();
    // 選ばせていない「種類」に触れない（段の名札・ゆうこの助言）＝画面に無いものを名指さない（`06 §12.1`）。
    expect(visibleText()).not.toContain("種類");
  });

  // 種類の書かれていない作業状態でも一般で始める（到達しない前提に頼らない＝変異チェックで生き残った分）。
  it("種類の無い作業状態で開いても、一般で始まり採用のカードは出ない", () => {
    useProjectStore.setState((st) => ({ meta: { ...st.meta, videoKind: undefined } }));
    render(<WizardScreen onNavigate={() => {}} />);
    expect(kindGroup()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByLabelText(/テーマ・タイトル/)).toBeTruthy();
  });

  // ⚠️ 画面まるごと・全部の段で探す（ADR-0076 決定6・CLAUDE.md §7）。
  it("一般の新しい動画では、どの段にも採用の言葉が出ない（画面まるごと）", () => {
    render(<WizardScreen onNavigate={() => {}} />);
    const seen: string[] = [];
    for (let step: number = WIZARD_STEP.kind; step <= WIZARD_STEP.ready; step += 1) {
      const text = visibleText();
      seen.push(text);
      for (const w of RECRUIT_WORDS) expect(text.includes(w), `段 ${step} に「${w}」が出ている`).toBe(false);
      if (step === WIZARD_STEP.ready) break;
      if (step === WIZARD_STEP.brief) fireEvent.change(screen.getByLabelText(/テーマ・タイトル/), { target: { value: "四半期の報告" } });
      fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    }
    // ⚠️ 空振りしていない＝4つの段を本当に見た（段ごとに見出しが違う）。
    expect(seen).toHaveLength(WIZARD_STEP.ready + 1);
    expect(seen[WIZARD_STEP.brief]).toContain("発表の内容を入力");
    expect(seen[WIZARD_STEP.materials]).toContain("写真・動画を追加");
    expect(seen[WIZARD_STEP.ready]).toContain("準備ができました");
  });

  // 走査が見張りとして働くこと＝採用動画では同じ走査が言葉を拾う（拾えない走査は「出ていない」に見えるだけ）。
  it("同じ走査は、採用動画の段では採用の言葉を拾う（見張りが空振りしていない）", () => {
    openAsRecruitVideo();
    render(<WizardScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(RECRUIT_WORDS.some((w) => visibleText().includes(w))).toBe(true);
  });
});

describe("鍵が無くても、以前に作った採用動画は見直せる（ADR-0076 決定3）", () => {
  it("採用が選ばれて開き、会社情報が残る・一般へ切り替えても採用のカードは消えず戻せる", () => {
    openAsRecruitVideo("テスト株式会社");
    render(<WizardScreen onNavigate={() => {}} />);
    const group = kindGroup();
    expect(group, "種類の選択が無い＝採用動画を見直せない").not.toBeNull();
    const recruit = within(group!).getByRole("button", { name: new RegExp(VIDEO_KIND_LABEL[VIDEO_KIND.recruit]) });
    const general = within(group!).getByRole("button", { name: new RegExp(VIDEO_KIND_LABEL[VIDEO_KIND.general]) });
    expect(recruit.getAttribute("aria-pressed")).toBe("true");
    // 一般へ切り替えても、採用のカードは残る（ウィザードを出るまで＝切り替えて戻せる）。
    fireEvent.click(general);
    expect(within(kindGroup()!).getByRole("button", { name: new RegExp(VIDEO_KIND_LABEL[VIDEO_KIND.recruit]) })).toBeTruthy();
    fireEvent.click(within(kindGroup()!).getByRole("button", { name: new RegExp(VIDEO_KIND_LABEL[VIDEO_KIND.recruit]) }));
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect((screen.getByLabelText(/会社名/) as HTMLInputElement).value).toBe("テスト株式会社");
    // 鍵が無いことを理由に、種類を書き換えない・会社情報を消さない（ADR-0026④）。
    const meta = useProjectStore.getState().meta;
    expect(meta.videoKind).toBe(VIDEO_KIND.recruit);
    expect(meta.companyInfo?.companyName).toBe("テスト株式会社");
  });
});

describe("鍵がある（ADR-0076 決定5）", () => {
  it("種類は2枚・一般が先で、新しい動画では一般が選ばれている", () => {
    setRecruitVideoKey(true);
    render(<WizardScreen onNavigate={() => {}} />);
    const group = kindGroup();
    expect(group).not.toBeNull();
    const cards = within(group!).getAllByRole("button");
    expect(cards.map((c) => c.querySelector(".action-card-title")?.textContent)).toEqual([
      VIDEO_KIND_LABEL[VIDEO_KIND.general],
      VIDEO_KIND_LABEL[VIDEO_KIND.recruit],
    ]);
    expect(cards[0].getAttribute("aria-pressed")).toBe("true");
    expect(cards[1].getAttribute("aria-pressed")).toBe("false");
    // 採用を選ぶと、会社情報を入れて採用動画として保存される。
    fireEvent.click(cards[1]);
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.change(screen.getByLabelText(/会社名/), { target: { value: "テスト株式会社" } });
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(useProjectStore.getState().meta.videoKind).toBe(VIDEO_KIND.recruit);
  });
});

describe("出す種類の決め方（wizardVideoKinds・ADR-0076 決定2・3・5）", () => {
  const { general, recruit } = VIDEO_KIND;
  it.each([
    [false, general, general, [general]],
    [false, undefined, general, [general]],
    [true, general, general, [general, recruit]],
    [false, recruit, general, [general, recruit]], // 保存済みが採用＝見直せる・切り替えて戻せる
    [false, general, recruit, [general, recruit]], // 開いている間に鍵が外れても、選んでいる採用を消さない
    [true, recruit, recruit, [general, recruit]],
  ] as const)("鍵=%s・保存済み=%s・いま=%s → %j", (key, saved, current, expected) => {
    expect(wizardVideoKinds(key, saved, current)).toEqual(expected);
  });
});

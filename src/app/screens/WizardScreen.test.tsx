// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WizardScreen } from "./WizardScreen";
import { stepsFor, wizardBackLabel } from "./wizardSteps";
import { BACK_TO_HOME_LABEL } from "../uiLabels";
import { VIDEO_KIND } from "../../domain/enums";
import { useProjectStore } from "../store/projectStore";
import type { Asset } from "../../domain/project/types";
import { ASSET_TYPE } from "../../domain/enums";

function photo(id: string, name: string): Asset {
  return { assetId: id, assetType: ASSET_TYPE.image, displayName: name, filePath: `${id}.png` };
}

// #401 の主眼＝ウィザードの離脱時コミットと、完了時の二重コミット防止をコンポーネントで検証する（ADR-0014・jsdom）。
describe("WizardScreen 入力保護（#401）", () => {
  const realApply = useProjectStore.getState().applyProjectInfo;

  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" }); // newProject のガードを外す
    useProjectStore.getState().newProject(); // 空の新規状態・step0 から
  });
  afterEach(() => {
    useProjectStore.setState({ applyProjectInfo: realApply }); // 上書きした action を戻す
  });

  it("会社名を入力して離脱すると、その内容が applyProjectInfo で store に確定される（離脱コミット）", () => {
    const spy = vi.fn();
    useProjectStore.setState({ applyProjectInfo: spy });
    const { unmount } = render(<WizardScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "次へ" })); // step0(種類/目的)→step1(会社情報)
    fireEvent.change(screen.getByLabelText(/会社名/), { target: { value: "テスト株式会社" } });
    spy.mockClear(); // ここまでの commit は除き、離脱(unmount)時の挙動だけを見る
    unmount();
    expect(spy).toHaveBeenCalledTimes(1); // 離脱で1回だけ確定される
    expect(spy.mock.calls[0][0].companyInfo.companyName).toBe("テスト株式会社");
  });

  it("会社名入力→次へ（確定）直後に離脱しても二重に applyProjectInfo しない（#401 レビュー・二重発火防止）", () => {
    const spy = vi.fn();
    useProjectStore.setState({ applyProjectInfo: spy });
    const { unmount } = render(<WizardScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "次へ" })); // step0→1
    fireEvent.change(screen.getByLabelText(/会社名/), { target: { value: "テスト株式会社" } });
    fireEvent.click(screen.getByRole("button", { name: "次へ" })); // step1→2：ここで1回 commit
    const afterCommit = spy.mock.calls.length;
    expect(afterCommit).toBeGreaterThan(0);
    unmount(); // 確定後に編集していない＝スナップショット一致で離脱コミットを skip
    expect(spy.mock.calls.length).toBe(afterCommit); // 増えない＝pushHistory の二重積みが起きない
  });

  it("入力せず（空フォームで）離脱しても applyProjectInfo を呼ばない（無駄な dirty/履歴を作らない）", () => {
    const spy = vi.fn();
    useProjectStore.setState({ applyProjectInfo: spy });
    const { unmount } = render(<WizardScreen onNavigate={() => {}} />);
    unmount(); // 何も入力していない＝会社名/テーマ空＝確定しない
    expect(spy).not.toHaveBeenCalled();
  });
});

// #547 P3-8：写真・動画ステップで間違えて選んだ素材を外せる。生成前なので参照する場面は無く、外しても
// どこも空欄にならない＝即時削除（この画面の「アピールしたいこと」の × と同じ・確認は挟まない）。
describe("WizardScreen 素材の外す（#547 P3-8）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    useProjectStore.setState({ wizardStep: 2 }); // 「写真・動画を追加」ステップから開く（step 初期値は wizardStep）
  });

  it("各素材に「外す」があり、押すとその素材だけが取り除かれる", () => {
    useProjectStore.setState({ assets: [photo("asset_a", "オフィス"), photo("asset_b", "社員")] });
    render(<WizardScreen onNavigate={() => {}} />);
    // 両方表示されている
    expect(screen.getByText("オフィス")).toBeInTheDocument();
    expect(screen.getByText("社員")).toBeInTheDocument();
    // ホバー説明（title）と読み上げ名（aria-label）が同じ＝同じボタンで名前が2通りに割れない（#547 P3-8 レビュー）
    const removeBtn = screen.getByRole("button", { name: "オフィスを外す" });
    expect(removeBtn.getAttribute("title")).toBe("オフィスを外す");
    // 「オフィス」を外す
    fireEvent.click(removeBtn);
    // store から消え、もう片方は残る
    const ids = useProjectStore.getState().assets.map((a) => a.assetId);
    expect(ids).toEqual(["asset_b"]);
    expect(screen.queryByText("オフィス")).toBeNull();
    expect(screen.getByText("社員")).toBeInTheDocument();
  });

  it("最後の1つを外すと「まだ素材はありません」に戻る（空状態の案内）", () => {
    useProjectStore.setState({ assets: [photo("asset_a", "オフィス")] });
    render(<WizardScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "オフィスを外す" }));
    expect(useProjectStore.getState().assets).toEqual([]);
    expect(screen.getByText(/まだ素材はありません/)).toBeInTheDocument();
  });

  it("外すと未保存（saveStatus=idle）になる＝自動保存で確定される", () => {
    useProjectStore.setState({ assets: [photo("asset_a", "オフィス")], saveStatus: "saved" });
    render(<WizardScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "オフィスを外す" }));
    expect(useProjectStore.getState().saveStatus).toBe("idle");
  });
});

// 必須は欄の側でも分かる（#1026）。
//
// ⚠️ **押して初めて分かる形だった**＝未入力だと「次へ」で止められるのに、欄の側に印が無く、
// 押すまで required と分からない（§2-5＝先に言う）。
// ⚠️ **色だけで伝えない**＝読み上げにも届くよう、文字（必須）で書く。
describe("必須の欄は、押す前に分かる（#1026）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
    // ⚠️ **段は持ち越される**（`wizardStep` は離脱しても残る＝#401）＝先頭から始める。
    useProjectStore.setState({ wizardStep: 0 });
  });

  /** ⚠️ **入口は種類/目的の段**＝会社情報の欄は「次へ」で1つ進めてから出る。 */
  const toCompanyStep = () => {
    render(<WizardScreen onNavigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
  };

  it("会社名（採用で必須）に印が付いている", () => {
    toCompanyStep();
    expect((screen.getByLabelText(/会社名/) as HTMLInputElement).labels?.[0]?.textContent, "必須の印が無い").toContain("必須");
  });

  // ⚠️ **必須でない欄には付けない**＝全部に付けると印の意味が無くなる。
  it("必須でない欄には印を付けない", () => {
    toCompanyStep();
    expect((screen.getByLabelText(/業種/) as HTMLInputElement).labels?.[0]?.textContent).not.toContain("必須");
  });

  // ⚠️ **画面まるごとで見る**（PR #1035 レビュー ℹ️・CLAUDE.md §7）＝欄ごとに書き並べる検査は、
  //   **付け忘れた1か所**を構造的に見つけられない（次に必須の欄が増えたとき何も言わない）。
  //   文字の印（`（必須）`）と欄の印（`aria-required`）は**必ず一致する**、を画面全体で見る。
  it("文字の印と欄の印がずれている欄が無い（画面まるごと）", () => {
    toCompanyStep();
    const mismatched: string[] = [];
    for (const el of Array.from(document.querySelectorAll("input, textarea"))) {
      const field = el as HTMLInputElement | HTMLTextAreaElement;
      const labelled = field.labels?.[0]?.textContent?.includes("必須") ?? false;
      const marked = field.getAttribute("aria-required") === "true";
      if (labelled !== marked) mismatched.push(`${field.labels?.[0]?.textContent ?? field.id}: 文字=${labelled} 欄=${marked}`);
    }
    expect(mismatched, "「（必須）」と `aria-required` が食い違う欄がある").toEqual([]);
  });

  it("見ている欄がある（走査が空振りしていない）", () => {
    toCompanyStep();
    expect(document.querySelectorAll("input, textarea").length, "欄を1つも見ていない").toBeGreaterThan(1);
    expect(
      Array.from(document.querySelectorAll("[aria-required=\"true\"]")).length,
      "必須の欄を1つも見ていない",
    ).toBeGreaterThanOrEqual(1);
  });
});


// 戻るは**行き先名を言う**（`06 §2` 規約3・#1026）。
//
// ⚠️ **もとは「戻る」だけ**で、この画面の戻るは**段によって行き先が変わる**（1つ前の段／
// いちばん最初は一覧）ので、押すまでどこへ出るのか分からなかった。
describe("戻るの行き先名（#1026・`06 §2` 規約3）", () => {
  beforeEach(() => {
    useProjectStore.getState().setExportRun({ phase: "idle" });
    useProjectStore.getState().newProject();
  });

  it("いちばん最初の段では、一覧へ戻ると言う", () => {
    render(<WizardScreen onNavigate={() => {}} />);
    expect(screen.getByRole("button", { name: BACK_TO_HOME_LABEL })).toBeTruthy();
  });

  it("進んだ段では、1つ前の段の名前を言う", () => {
    render(<WizardScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "次へ" })); // step0 → step1
    expect(screen.getByRole("button", { name: "動画の種類と目的へ戻る" })).toBeTruthy();
  });

  // ⚠️ **段を辿って画面で見る**（#1141 レビュー由来 🟡）＝もとは step0→1 の1遷移だけを見ていて、
  // 残りは `wizardBackLabel(i, steps)` を **同じ配列自身**と突き合わせる自己同一性の検査だった。
  // それだと `backName` の**取り違え**（「写真・動画」と「読み上げの声」が入れ替わる）が捕まらない。
  it.each([
    [VIDEO_KIND.recruit, ["動画の種類と目的", "会社情報", "写真・動画", "読み上げの声"]],
    [VIDEO_KIND.general, ["動画の種類と目的", "発表の内容", "写真・動画", "読み上げの声"]],
  ])("%s：段を進めるたびに、1つ前の段の名前へ変わる", (kind, names) => {
    useProjectStore.setState((st) => ({ meta: { ...st.meta, videoKind: kind } }));
    render(<WizardScreen onNavigate={() => {}} />);
    // いちばん最初は一覧へ。
    expect(screen.getByRole("button", { name: BACK_TO_HOME_LABEL })).toBeTruthy();
    names.forEach((name, i) => {
      fireEvent.click(screen.getByRole("button", { name: "次へ" }));
      // 2段目は必須（未入力だと次へで止められる）＝進むために埋める。
      if (i === 0) {
        const field = kind === VIDEO_KIND.general ? /テーマ・タイトル/ : /会社名/;
        fireEvent.change(screen.getByLabelText(field), { target: { value: "テスト" } });
      }
      expect(
        screen.getByRole("button", { name: `${name}へ戻る` }),
        `${name} へ戻れません`,
      ).toBeTruthy();
    });
  });

  it("段が1つしか無くても、戻るは行き止まりにならない", () => {
    const one = [{ label: "ひとつだけ", backName: "ひとつ" }] as const;
    expect(wizardBackLabel(0, one)).toBe(BACK_TO_HOME_LABEL);
  });

  it("どの段にも行き先の呼び名がある（名札だけ足して呼び名を忘れない）", () => {
    for (const kind of [VIDEO_KIND.recruit, VIDEO_KIND.general]) {
      const steps = stepsFor(kind);
      for (const s of steps) {
        expect(s.backName.length, `${s.label} に行き先の呼び名がありません`).toBeGreaterThan(0);
        // ⚠️ **呼び名は名札から採る**（#1141 レビュー由来 🟡）＝画面に出ていない言い換えを
        // 足さない（§2-3）。実際に最後の段だけ「動画案づくり」という、この画面のどこにも
        // 出ていない語になっていた。
        expect(
          s.label.includes(s.backName),
          `${s.label} の呼び名「${s.backName}」が名札に出てきません（新しい言い換えです）`,
        ).toBe(true);
        // ⚠️ **名札をそのまま使わない**＝「会社情報を入力へ戻る」は読めない。
        // 語尾を並べて見ると次に足した動詞を取りこぼすので、**動詞の目印（を）**で見る。
        expect(
          s.backName.includes("を"),
          `${s.label} の呼び名「${s.backName}」が動詞のままです`,
        ).toBe(false);
      }
      // 段の数だけ戻るの文言が作れる（いちばん最初は一覧）。
      expect(wizardBackLabel(0, steps)).toBe(BACK_TO_HOME_LABEL);
      for (let i = 1; i < steps.length; i += 1) {
        expect(wizardBackLabel(i, steps)).toBe(`${steps[i - 1]!.backName}へ戻る`);
      }
      // ⚠️ **範囲の外は一覧へ倒す**（#1141 レビュー由来 🟡）＝前の段が無いときは
      // 行き止まりにせず一覧へ出す、という**意図**をここで固定する（副作用ではない）。
      expect(wizardBackLabel(-1, steps)).toBe(BACK_TO_HOME_LABEL);
      expect(wizardBackLabel(steps.length + 1, steps)).toBe(BACK_TO_HOME_LABEL);
    }
  });
});

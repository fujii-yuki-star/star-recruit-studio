// @vitest-environment jsdom
// 言葉の読み方の画面（ADR-0037・#350）。
//
// ⚠️ **「アクセント型」「モーラ」を画面に出さない**（決定6・§2-3）を実際の描画で固定する。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../infrastructure/readingDictFs", () => ({
  emptyReadingDict: () => ({ version: 1, entries: [], links: {} }),
  loadReadingDict: vi.fn(),
  saveReadingDict: vi.fn(async () => {}),
  exportReadingDictTo: vi.fn(async () => {}),
  importReadingDictFrom: vi.fn(async () => ({ entries: [], dropped: 0 })),
}));
vi.mock("../../infrastructure/voiceProviders/readingDictSync", () => ({
  markReadingDictChanged: vi.fn(),
  syncAndCollectConflicts: vi.fn(async () => ({ conflicts: [], error: null })),
  overwriteConflict: vi.fn(async () => {}),
}));
vi.mock("../../infrastructure/dialog", () => ({
  showSaveReadingDictDialog: vi.fn(async () => null),
  showOpenReadingDictDialog: vi.fn(async () => null),
}));

import { ReadingDictSection } from "./ReadingDictSection";
import { importReadingDictFrom, loadReadingDict, saveReadingDict } from "../../infrastructure/readingDictFs";
import { markReadingDictChanged } from "../../infrastructure/voiceProviders/readingDictSync";
import { showOpenReadingDictDialog } from "../../infrastructure/dialog";

const entry = { surface: "宇都宮", yomi: "ウツノミヤ", accentType: 4 };

beforeEach(() => {
  vi.mocked(loadReadingDict).mockResolvedValue({ version: 1, entries: [], links: {} });
});
afterEach(() => vi.clearAllMocks());

describe("ReadingDictSection", () => {
  it("登録が無いときは次の行動を出す（空欄のまま置き去りにしない）", async () => {
    render(<ReadingDictSection />);
    expect(await screen.findByText(/まだ登録がありません/)).toBeInTheDocument();
  });

  it("保存済みの語を一覧に出す（下がる場所は印で見せる）", async () => {
    vi.mocked(loadReadingDict).mockResolvedValue({ version: 1, entries: [entry], links: {} });
    render(<ReadingDictSection />);
    expect(await screen.findByText(/宇都宮：ウツノミ↓ヤ/)).toBeInTheDocument();
  });

  /** ⚠️ §2-3＝実装用語を画面に出さない。 */
  it("「アクセント」「モーラ」を画面に出さない", async () => {
    vi.mocked(loadReadingDict).mockResolvedValue({ version: 1, entries: [entry], links: {} });
    const { container } = render(<ReadingDictSection />);
    await screen.findByText(/宇都宮/);
    fireEvent.change(screen.getByLabelText("読み（カタカナ）"), { target: { value: "ウツノミヤ" } });
    expect(container.textContent).not.toMatch(/アクセント|モーラ|accent|mora/i);
  });

  it("カタカナでない読みは受け付けず、次の行動を出す", async () => {
    render(<ReadingDictSection />);
    await screen.findByText(/まだ登録がありません/);
    fireEvent.change(screen.getByLabelText("言葉"), { target: { value: "宇都宮" } });
    fireEvent.change(screen.getByLabelText("読み（カタカナ）"), { target: { value: "うつのみや" } });
    expect(screen.getByText(/カタカナで入力してください/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "読み方を追加する" })).toBeDisabled();
  });

  it("読みを入れると聞き比べの候補が出る（下がらない形＋粒の数だけ）", async () => {
    render(<ReadingDictSection />);
    await screen.findByText(/まだ登録がありません/);
    fireEvent.change(screen.getByLabelText("読み（カタカナ）"), { target: { value: "キョウト" } });
    // キョ／ウ／ト＝3粒 → 候補は 4つ（下がらない＋3）。
    expect(screen.getByRole("button", { name: "キョウト", pressed: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "キョ↓ウト" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "キョウト↓" })).toBeInTheDocument();
  });

  /** ⚠️ 決定6＝既定は先頭で下がる形。 */
  it("読みを入れた時点で「先頭で下がる形」が選ばれている", async () => {
    render(<ReadingDictSection />);
    await screen.findByText(/まだ登録がありません/);
    fireEvent.change(screen.getByLabelText("読み（カタカナ）"), { target: { value: "キョウト" } });
    expect(screen.getByRole("button", { name: "キョ↓ウト" })).toHaveAttribute("aria-pressed", "true");
  });

  it("保存すると書き込み、次に声を作るときそろえ直すよう印を付ける", async () => {
    render(<ReadingDictSection />);
    await screen.findByText(/まだ登録がありません/);
    fireEvent.change(screen.getByLabelText("言葉"), { target: { value: " 宇都宮 " } });
    fireEvent.change(screen.getByLabelText("読み（カタカナ）"), { target: { value: "ウツノミヤ" } });
    fireEvent.click(screen.getByRole("button", { name: "ウツノミ↓ヤ" }));
    fireEvent.click(screen.getByRole("button", { name: "読み方を追加する" }));
    await waitFor(() => expect(saveReadingDict).toHaveBeenCalled());
    // 言葉は空白を落として保存する（見た目が違うだけの語を二重に持たない）。
    expect(vi.mocked(saveReadingDict).mock.calls[0][0].entries).toEqual([entry]);
    expect(markReadingDictChanged).toHaveBeenCalled();
  });

  it("同じ言葉を足そうとしたら、置き換わることを先に知らせる", async () => {
    vi.mocked(loadReadingDict).mockResolvedValue({ version: 1, entries: [entry], links: {} });
    render(<ReadingDictSection />);
    await screen.findByText(/宇都宮/);
    fireEvent.change(screen.getByLabelText("言葉"), { target: { value: "宇都宮" } });
    expect(screen.getByText(/同じ言葉が既にあります/)).toBeInTheDocument();
  });

  it("「直す」で開いた語は、自分自身と重なったことにしない", async () => {
    vi.mocked(loadReadingDict).mockResolvedValue({ version: 1, entries: [entry], links: {} });
    render(<ReadingDictSection />);
    fireEvent.click(await screen.findByRole("button", { name: "直す" }));
    expect(screen.queryByText(/同じ言葉が既にあります/)).not.toBeInTheDocument();
  });

  it("一覧から外すと書き込む", async () => {
    vi.mocked(loadReadingDict).mockResolvedValue({ version: 1, entries: [entry], links: {} });
    render(<ReadingDictSection />);
    fireEvent.click(await screen.findByRole("button", { name: "一覧から外す" }));
    // ⚠️ **確認を通す**（🟡27）＝1クリックでは消えない。
    fireEvent.click(screen.getAllByRole("button", { name: "一覧から外す" })[0]);
    await waitFor(() => expect(saveReadingDict).toHaveBeenCalled());
    expect(vi.mocked(saveReadingDict).mock.calls[0][0].entries).toEqual([]);
  });

  /** ⚠️ 決定8＝読み込みは足すのが既定で、同じ言葉があるとき黙って上書きしない。 */
  it("読み込みで重なった語は上書きせず、選ばせる", async () => {
    vi.mocked(loadReadingDict).mockResolvedValue({ version: 1, entries: [entry], links: {} });
    vi.mocked(showOpenReadingDictDialog).mockResolvedValue("C:/dict.json");
    vi.mocked(importReadingDictFrom).mockResolvedValue({ entries: [{ surface: "宇都宮", yomi: "ウツノミヤ", accentType: 0 }], dropped: 0 });
    render(<ReadingDictSection />);
    await screen.findByText(/宇都宮/);
    fireEvent.click(screen.getByRole("button", { name: "一覧を読み込む" }));
    expect(await screen.findByRole("button", { name: "読み込んだ方にする" })).toBeInTheDocument();
    // 置き換えるまでは、いまの読みのまま。
    expect(vi.mocked(saveReadingDict).mock.calls[0][0].entries).toEqual([entry]);
  });

  it("登録が無ければ書き出せない（空のファイルを作らせない）", async () => {
    render(<ReadingDictSection />);
    await screen.findByText(/まだ登録がありません/);
    expect(screen.getByRole("button", { name: "一覧を書き出す" })).toBeDisabled();
  });

  /**
   * ⚠️ **控え（エンジンの語との繋がり）を巻き戻さない**（α-6 出口監査 🟡22）＝画面が持っているのは
   * 開いた時点の控えで、その後「そろえる」がディスクへ書き足している。画面の側を丸ごと書き戻すと
   * 直した読みが音声ソフトへ映らないまま声が作られ、外した語も共有辞書から消えなくなる。
   */
  it("保存のとき、画面より新しい控えを巻き戻さない", async () => {
    vi.mocked(loadReadingDict)
      .mockResolvedValueOnce({ version: 1, entries: [], links: {} }) // 画面が開いた時点
      .mockResolvedValue({ version: 1, entries: [], links: { 宇都宮: "uuid-new" } }); // そろえた後のディスク
    render(<ReadingDictSection />);
    fireEvent.change(await screen.findByLabelText("言葉"), { target: { value: "宇都宮" } });
    fireEvent.change(screen.getByLabelText("読み（カタカナ）"), { target: { value: "ウツノミヤ" } });
    fireEvent.click(screen.getByRole("button", { name: "読み方を追加する" }));
    await waitFor(() => expect(vi.mocked(saveReadingDict)).toHaveBeenCalled());
    expect(vi.mocked(saveReadingDict).mock.calls[0][0].links).toEqual({ 宇都宮: "uuid-new" });
  });
});

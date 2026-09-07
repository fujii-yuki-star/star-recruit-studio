// @vitest-environment jsdom
// 設定画面の「先に見せるもの／畳んでおくもの」と「どこまで効くか」（#1032）。
//
// ⚠️ 自分で「通常は変更不要です」「通常は空のままで大丈夫です」と書いている欄が**先頭で開きっぱなし**で、
//    読み飛ばしを文章でお願いしていた。さらに、**すべての動画に効く設定**と**いま開いている動画だけ**の
//    設定が同じカードに混ざり、違いは末尾の一文だけだった（先に触ってから読むことになる）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("../../infrastructure/aiClient", async (importActual) => ({
  ...(await importActual<typeof import("../../infrastructure/aiClient")>()),
  hasApiKey: vi.fn(() => Promise.resolve(false)),
}));

import { SettingsScreen } from "./SettingsScreen";

/** その欄を包んでいる開閉（`<details>`）。包まれていなければ null。 */
function foldOf(labelText: string): HTMLDetailsElement | null {
  return screen.getByText(labelText).closest("details");
}

/** 開閉を開く（jsdom は `summary` のクリックで `toggle` を出さないので、直接開いて知らせる）。 */
function openFold(fold: HTMLDetailsElement | null): void {
  expect(fold, "開こうとした開閉が無い").not.toBeNull();
  const el = fold as HTMLDetailsElement;
  act(() => {
    el.open = true;
    el.dispatchEvent(new Event("toggle", { bubbles: false }));
  });
}

describe("設定：普段触らないものは畳む（#1032）", () => {
  beforeEach(() => {
    // 開閉は覚えるので、前の検査の記憶を持ち越さない。
    try { window.localStorage.clear(); } catch { /* 保存できない環境では既定のまま */ }
  });
  afterEach(() => vi.restoreAllMocks());

  it("「モデル」は畳んだ「上級者向け」の中にある（先頭で開きっぱなしにしない）", async () => {
    render(<SettingsScreen onNavigate={vi.fn()} />);
    await screen.findByText("接続の状態");
    const fold = foldOf("モデル");
    expect(fold, "「モデル」が開閉に包まれていない").not.toBeNull();
    expect(fold?.open, "既定で開いている").toBe(false);
    expect(fold?.querySelector("summary")?.textContent).toBe("上級者向け");
  });

  it("「音声ソフトの接続先」も畳んだ「上級者向け」の中にある", async () => {
    render(<SettingsScreen onNavigate={vi.fn()} />);
    await screen.findByText("接続の状態");
    const fold = foldOf("音声ソフトの接続先");
    expect(fold, "「音声ソフトの接続先」が開閉に包まれていない").not.toBeNull();
    expect(fold?.open, "既定で開いている").toBe(false);
  });

  it("既定と違う値を入れてあるときは開いて出す（自分で変えた設定を見失わない）", async () => {
    // モデルも接続先も**既定ではない**状態で開く。
    window.localStorage.setItem("app.aiModel", "gemini-2.5-flash-lite");
    window.localStorage.setItem("app.voicevoxUrl", "http://192.168.0.9:50021");
    render(<SettingsScreen onNavigate={vi.fn()} />);
    await screen.findByText("接続の状態");
    expect(foldOf("モデル")?.open, "既定と違うモデルなのに畳んでいる").toBe(true);
    expect(foldOf("音声ソフトの接続先")?.open, "既定と違う接続先なのに畳んでいる").toBe(true);
  });

  it("空白だけの接続先は「入っていない」と数える（畳んだまま）", async () => {
    // 画面から入れると前後の空白は落ちるが、古い版や手書きの値は残りうる。
    window.localStorage.setItem("app.voicevoxUrl", "   ");
    render(<SettingsScreen onNavigate={vi.fn()} />);
    await screen.findByText("接続の状態");
    expect(foldOf("音声ソフトの接続先")?.open, "空白だけなのに「入っている」と数えている").toBe(false);
  });

  it("2つの「上級者向け」は別々に覚える（片方を開くともう片方も開く、を作らない）", async () => {
    const first = render(<SettingsScreen onNavigate={vi.fn()} />);
    await screen.findByText("接続の状態");
    // AI 側だけを開く（開閉はこの時点で覚えられる）。
    openFold(foldOf("モデル"));
    first.unmount();
    // 開き直したとき、AI 側は覚えていて、声側は**畳んだまま**。
    render(<SettingsScreen onNavigate={vi.fn()} />);
    await screen.findByText("接続の状態");
    expect(foldOf("モデル")?.open, "開いたはずの側を覚えていない").toBe(true);
    expect(foldOf("音声ソフトの接続先")?.open, "触っていない側まで開いている（記憶を共有している）").toBe(false);
  });
});

describe("設定：どこまで効くかで分ける（#1032）", () => {
  beforeEach(() => {
    try { window.localStorage.clear(); } catch { /* 保存できない環境では既定のまま */ }
  });
  afterEach(() => vi.restoreAllMocks());

  /** その見出しのカード。 */
  function cardOf(title: string): HTMLElement {
    const card = screen.getByRole("heading", { level: 2, name: title }).closest(".card");
    expect(card, `「${title}」のカードが無い`).not.toBeNull();
    return card as HTMLElement;
  }

  it("この動画だけの設定（速さ・高さ・抑揚）は、別のカードに分かれている", async () => {
    render(<SettingsScreen onNavigate={vi.fn()} />);
    await screen.findByText("接続の状態");
    const mine = cardOf("この動画の読み上げ");
    expect(mine.textContent).toContain("話す速さ");
    expect(mine.textContent).toContain("声の高さ");
    expect(mine.textContent).toContain("抑揚");
    // すべての動画に効くもの（声・接続先）は混ざっていない。
    expect(mine.textContent).not.toContain("声（キャラクター・スタイル）");
    expect(mine.textContent).not.toContain("音声ソフトの接続先");
  });

  it("どちらのカードも「どこまで効くか」を説明の先頭で言う（触ってから読む、を作らない）", async () => {
    render(<SettingsScreen onNavigate={vi.fn()} />);
    await screen.findByText("接続の状態");
    expect(cardOf("ナレーターの声").textContent).toContain("すべての動画に使われます");
    expect(cardOf("この動画の読み上げ").textContent).toContain("いま開いている動画の読み上げにだけ使われます");
  });
});

// @vitest-environment jsdom
// 動画案づくりに使うモデルIDを、実機で通った値に留める（2026-09-25 の実測）。
//
// ⚠️ **提供元の都合で黙って死ぬ**＝`gemini-2.5-flash` は「新規の利用者には提供しない」と
// されて `404` を返すようになり、**アプリ側は何も変えていないのに動画案づくりが全滅した**
//（画面には「時間をおいて、もう一度お試しください」としか出ないので、待っても直らない）。
// ⚠️ **だから数で留める**＝名前を変えるときは、**実機で通したうえで**ここも直す、を強制する。
import { describe, expect, it } from "vitest";
import { DEFAULT_AI_MODEL, getAiModel } from "./appSettings";

describe("動画案づくりのモデルID（実機で確かめた値に留める）", () => {
  it("既定は実機で要求が通った名前", () => {
    expect(DEFAULT_AI_MODEL).toBe("gemini-3.8-flash");
  });

  // ⚠️ **使えなくなった系統を名指しで止める**＝「2.5 系に戻す」は、手元の検査では気づけないまま
  // 利用者の端末でだけ全滅する（実際にそうなった）。
  it("提供が終わった 2.5 系には戻さない", () => {
    expect(DEFAULT_AI_MODEL.startsWith("gemini-2.5")).toBe(false);
  });

  it("設定が空なら既定を使い、入っていればそちらを使う", () => {
    localStorage.removeItem("app.aiModel");
    expect(getAiModel()).toBe(DEFAULT_AI_MODEL);
    localStorage.setItem("app.aiModel", "  my-model  ");
    expect(getAiModel(), "前後の空白は落とす").toBe("my-model");
    localStorage.setItem("app.aiModel", "   ");
    expect(getAiModel(), "空白だけなら既定へ倒す").toBe(DEFAULT_AI_MODEL);
    localStorage.removeItem("app.aiModel");
  });
});

// 頼まれた書き出しが「どの出口でも、ちょうど1回だけ返る」ことの門番（ADR-0042 ④・#1184）。
//
// ⚠️ **なぜ実物を走らせないか**＝書き出しが**最後まで成功する**筋は jsdom では通せない
// （キャンバスで毎コマ描くため）。このリポジトリに成功まで走らせた検査は1つも無く、
// どれも `setExportRun({ phase: "done" })` で状態を置いている。
// ⚠️ **だから構造で留める**＝「返さない出口が増えた」ことを**数で**気づけるようにする
// （返さないと、頼んだ側＝AI は**終わらない仕事を待ち続ける**・§2-5 の行き止まり）。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// ⚠️ **改行を揃える**＝このリポジトリの作業ツリーは CRLF なので、目印が当たらない
// （最初これで「終わりが見つからない」と落ちた＝門番自身の穴）。
const SRC = readFileSync('src/app/screens/ExportScreen.tsx', 'utf8').replace(/\r\n/g, '\n');

/** `startExport` の本体だけを切り出す（ほかの関数の `return` を数えない）。 */
export function startExportBody(src: string): string {
  const at = src.indexOf('async function startExport()');
  if (at < 0) throw new Error('startExport が見つからない＝この門番を見直す');
  const end = src.indexOf('\n  }\n', at);
  if (end < 0) throw new Error('startExport の終わりが見つからない');
  return src.slice(at, end);
}

describe('頼まれた書き出しは、どの出口でも返る（#1184）', () => {
  const body = startExportBody(SRC);

  // ⚠️ **取り出しは関数の先頭**＝手前で抜けると保存先が残り、**次に人が押した書き出し**がそこへ書く。
  it('頼まれごとは、いちばん先に取り出す', () => {
    const take = body.indexOf('takePendingExport()');
    const firstReturn = body.indexOf('return;');
    expect(take).toBeGreaterThan(0);
    expect(take, '早期 return より後で取り出している').toBeLessThan(firstReturn);
  });

  // ⚠️ **「できた」は1か所だけ**＝増えていたら、成功でない道が成功を名乗っている。
  it('「できた」で返すのは1か所だけ', () => {
    expect(body.split('settleJob(true)').length - 1).toBe(1);
  });

  /**
   * ⚠️ **実数で留める**＝`return;` の数と「返す」の数が**同じ割合で**増えるとは限らない。
   * 出口を1つ足して返し忘れたら、ここが赤くなる（減らしたときも同じ）。
   * 内訳＝手前の3つ（走行中・使えない・場面ゼロ）＋保存先まわり2つ（やめた・選べない）＋
   * 準備の3つ（公開前チェック・締め・名乗れない）＋失敗の catch ＋ finally の取りこぼし拾い。
   * ⚠️ **`startExport` の外にもう1つある**（PR #1197 レビュー 🟡）＝始めた側（自動起動の effect）で、
   * **`try` に入る前に例外で抜けた回**を拾う。**それは本体の外なのでここでは数えない**。
   */
  it('「できなかった」で返す所の数が、記録と一致する', () => {
    expect(
      body.split('settleJob(false)').length - 1,
      '返さない出口が増減した＝返し忘れていないか数え直す',
    ).toBe(10);
  });

  // ⚠️ **最後の網は `finally`**＝`try` の中の早期 return は成功でも失敗でもないまま抜ける。
  it('最後に取りこぼしを拾う', () => {
    const fin = body.lastIndexOf('settleJob(false)');
    const fly = body.lastIndexOf('} finally {');
    expect(fly, 'finally が見つからない＝この門番を見直す').toBeGreaterThan(0);
    expect(fin, '最後の拾いが finally の中に無い').toBeGreaterThan(fly);
  });
});

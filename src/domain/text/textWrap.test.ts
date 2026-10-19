// テキストの折返し（純粋関数・#209／#928）。
import { describe, expect, it } from 'vitest';
import { wrapText } from './textWrap';


// 字間（#264）も数える（#928）。
//
// ⚠️ **数えないと、はみ出し判定が実際より狭く見る**＝字間を広げた文字は横に長くなるのに、
// 折返しの計算が字間なしの幅で見ていた。絵はプレビュー＝書き出しで同じ関数を共有するので割れないが、
// **画面外へ出る字幕に警告が出ない**（`subtitleOverflowsCanvas` が見逃す）。
describe('字間を数える（#928）', () => {
  // 全角は 1.0em＝100px（fontSize 100）。幅 350px なら字間 0 で3文字入る。
  const wrap = (spacing: number) => wrapText('あいうえお', 350, 100, 9, spacing, undefined);

  it('字間が 0 なら今までどおり（既に作った動画の折返しを変えない）', () => {
    expect(wrap(0)).toEqual(['あいう', 'えお']);
  });

  it('字間を広げると早く折り返す', () => {
    // 送り 0.3em=30px が2文字目以降に入る＝3文字目で 100+130+130=360 > 350。
    expect(wrap(0.3)).toEqual(['あい', 'うえ', 'お']);
  });

  it('末尾の字間は数えない（数えると1文字ぶん狭く見える）', () => {
    // 送り 0.25em=25px。3文字ぶんの送りを数えると 100*3+25*3=375>350 で2文字になるが、
    // 実際に要るのは**あいだの2つ**だけ＝100*3+25*2=350 でちょうど収まる。
    expect(wrapText('あいうえ', 350, 100, 9, 0.25, undefined)).toEqual(['あいう', 'え']);
  });

  it('行頭へ送り直した文字には送りを足さない', () => {
    // 2行目の先頭「え」は1文字目なので、行頭に送りぶんの空きができない。
    expect(wrapText('あいうえお', 250, 100, 9, 0.5, undefined)).toEqual(['あい', 'うえ', 'お']);
  });

  // ⚠️ **1文字目は必ず置く**（送りを足しても折り返さない）＝置かないと空行が出るか、
  // 同じ文字を延々と送り続けることになる。既存の `line.length > 0` の門がこれを担っている。
  it('箱より広い1文字でも、その行に置く（空行を作らない）', () => {
    expect(wrapText('あい', 100, 100, 9, 0.5, undefined)).toEqual(['あ', 'い']);
  });

  it('明示改行のあとも1文字目から数え直す', () => {
    expect(wrapText('あい\nうえ', 350, 100, 9, 0.5, undefined)).toEqual(['あい', 'うえ']);
  });
});

// 欧文は単語の切れ目で折る（業界の型・2026-10-19 の実機で `CORP`／`ORATION` と割れていた）。
// 見積もり（字体なし）で英字は 0.55em＝55px（fontSize 100）。
describe('欧文は単語の切れ目で折る', () => {
  it('単語の途中では折らず、単語ごと次の行へ送る', () => {
    // 「STARIO SYSTEM」は 13字＝715px。幅 600 なら「STARIO 」で折り、「SYSTEM」は丸ごと次の行。
    expect(wrapText('STARIO SYSTEM', 600, 100, 3, 0, undefined)).toEqual(['STARIO ', 'SYSTEM']);
  });

  it('空白は前の行の末尾に残す＝つなげ直すと元の文に戻る（切り詰めの誤判定を作らない）', () => {
    const lines = wrapText('AB CD EF GH', 300, 100, 9, 0, undefined);
    expect(lines.join('')).toBe('AB CD EF GH');
    expect(lines.every((l) => !l.startsWith(' '))).toBe(true); // 次の行は空白から始まらない
  });

  it('行より長い1語は、送る先が無いので文字で折る', () => {
    // 10字＝550px の1語を幅 300 で。
    expect(wrapText('ABCDEFGHIJ', 300, 100, 9, 0, undefined)).toEqual(['ABCDE', 'FGHIJ']);
  });

  it('日本語は今までどおり文字ごと・日本語と英字の境目でも折れる', () => {
    // 「採用」(200) のあとに「STARIO」(330)＝530 > 400。英字の頭（日本語との境目）で折る。
    expect(wrapText('採用STARIO', 400, 100, 9, 0, undefined)).toEqual(['採用', 'STARIO']);
    expect(wrapText('あいうえお', 350, 100, 9, 0, undefined)).toEqual(['あいう', 'えお']);
  });

  it('送った単語にも字間を数える（2文字目以降）', () => {
    // 字間 0.1em=10px。「AB CD」で CD を送ると、新しい行は C(55)+10+D(55)=120。
    const lines = wrapText('AB CD', 200, 100, 9, 0.1, undefined);
    expect(lines).toEqual(['AB ', 'CD']);
  });

  it('行数の上限で切るときは … で打ち切る（送るはずの単語は残りとして数える）', () => {
    expect(wrapText('STARIO SYSTEM', 600, 100, 1, 0, undefined)).toEqual(['STARIO…']);
    expect(wrapText('AB CD', 200, 100, 1, 0, undefined)).toEqual(['AB…']);
  });

  it('最後の文字で単語を送るときも、上限なら … にする（送った単語が残り）', () => {
    // 「AB CD」幅 250：A,B,空白,C=220、D で 275 > 250 → 「C」を送る。D はこの段落の最後の文字。
    expect(wrapText('AB CD', 250, 100, 1, 0, undefined)).toEqual(['AB…']);
  });

  it('送った単語の幅は字間込みで数える（続く文字の折り位置が変わる）', () => {
    // 字間 0.5em=50px。1行目「A BC」=370・D で 475 > 430 → 「BC」を送る。
    // 新しい行は B(55)+C(105)=160 → D 265 → E 370 → F 475 > 430 で折る＝「BCDE」。
    // 送った単語の字間や文字数を数え落とすと 50px 狭く見て「BCDEF」まで入れてしまう。
    expect(wrapText('A BCDEFG', 430, 100, 9, 0.5, undefined)).toEqual(['A ', 'BCDE', 'FG']);
  });

  it('折り返しの位置にちょうど空白が来ても、上限で残りがあれば … にする', () => {
    // 「ABCD EF」：ABCD=220、空白で 275 > 250 → 空白を前の行へ残して折る。残り「EF」がある。
    expect(wrapText('ABCD EF', 250, 100, 1, 0, undefined)).toEqual(['ABCD…']);
  });
});

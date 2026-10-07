// 断った理由が、頼んだ側に**必ず**届く（#1212）。**構造で留める**。
//
// ⚠️ **なぜ構造で見るか**＝これは「書き忘れると静かに戻る」種類の穴です。
// `finishStartupJob(false, forwarded)` と**2つだけ**で呼べてしまうと、その断りは
// **画面にしか出ません**（＝資料を読んでいる相手にしか効かない契約になる）。
// 呼び方を数えておけば、**新しい断りを足した回に落ちます**。
//
// ⚠️ **見つけ方**＝#1205 の調査中、頼まれごとが断られたのに**理由がどこにも無い**ことに気づいた。
// `18_EXTERNAL_AGENT_CONTRACT.md` は断りの文を**契約として**書いているのに、
// 実行時には**標準エラーにも、困りごとの記録にも、何も出て**いなかった。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 頼まれごとの締めを返している場所（ここ以外から返すなら、この並びに足すこと）。 */
const CALLERS = [
  'src/app/hooks/useStartupJob.ts',
  'src/app/screens/ExportScreen.tsx',
  'src/app/screens/TimelineProjectScreen.tsx',
] as const;

const srcOf = (p: string): string => readFileSync(p, 'utf8');

/** `finishStartupJob(` の呼び出しを、引数の並びごと取り出す（入れ子の括弧まで見る）。 */
function callsOf(src: string): string[] {
  const out: string[] = [];
  const needle = 'finishStartupJob(';
  let i = src.indexOf(needle);
  while (i >= 0) {
    let depth = 0;
    let j = i + needle.length - 1;
    for (; j < src.length; j += 1) {
      if (src[j] === '(') depth += 1;
      else if (src[j] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(i, j + 1));
    i = src.indexOf(needle, j + 1);
  }
  return out;
}

/** その呼び出しの引数の数（いちばん外の括弧の中を、深さ0のカンマで割る）。 */
function argCount(call: string): number {
  const inner = call.slice(call.indexOf('(') + 1, call.length - 1).trim();
  if (inner === '') return 0;
  let depth = 0;
  let n = 1;
  for (const ch of inner) {
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) n += 1;
  }
  return n;
}

describe('断った理由が、頼んだ側に届く（#1212）', () => {
  // ⚠️ **走査そのものを検査する**＝取り出せていないのに緑、を防ぐ（門番が「見えていないのに緑」になる型）。
  it('締めを返している場所を、ひとつ残らず拾えている', () => {
    const counts = CALLERS.map((p) => callsOf(srcOf(p)).length);
    // 呼び出しの実数で留める（増減したら、その回に理由を渡しているか確かめて数を直す）。
    expect(counts, '締めを返す場所の数が変わった').toEqual([13, 1, 2]);
  });

  it('どの呼び出しも、理由の文まで渡している（2つだけで呼んでいない）', () => {
    const bare: string[] = [];
    for (const p of CALLERS) {
      for (const call of callsOf(srcOf(p))) {
        if (argCount(call) < 3) bare.push(`${p}: ${call.replace(/\s+/g, ' ')}`);
      }
    }
    expect(
      bare.join('\n'),
      '理由を渡していない締めがある＝その断りは画面にしか出ない（頼んだ側には数字しか届かない）',
    ).toBe('');
  });

  // ⚠️ **運ぶ側が受け取れる形か**＝口が2つ（`ok` と `forwarded`）のままなら、上の検査は通っても
  // 文はどこへも行かない。**運び口があること**を別に見る。
  it('運ぶ口（`message`）が、Rust へ渡るところまで開いている', () => {
    const fs = srcOf('src/infrastructure/startupFs.ts');
    expect(fs, '運ぶ口が引数に無い').toContain('message?: string | null');
    expect(fs, 'Rust へ渡していない').toContain("invoke('finish_startup_job', { ok, forwarded, message: message ?? null })");
  });

  // ⚠️ **Rust 側が実際に外へ出しているか**＝受け取っても捨てていたら、届いていない。
  // ⚠️ **できた回も出す**（#1366）＝文字が「…」で切れていても終了コードは 0 なので、注意を渡さないと
  // 頼んだ側は気づけない。代わりに**成否は終了コードだけで読む**ことを契約（`18 §18.5`）に書く
  // （以前は「成功の標準エラーに文が混ざると失敗と読まれる」ので断った回だけ出していた）。
  it('Rust が、文を受け取ったら標準エラーへ出す（できた回も）・契約は成否を終了コードで読むと書いている', () => {
    const rs = srcOf('src-tauri/src/lib.rs');
    const body = rs.slice(rs.indexOf('fn finish_startup_job('), rs.indexOf('/// アプリを閉じる前の後片づけ'));
    expect(body, '文を受け取っていない').toContain('message: Option<String>');
    expect(body, '標準エラーへ出していない').toContain('eprintln!("{m}")');
    expect(body, 'できた回に出さない条件が残っている').not.toContain('!ok && !m.is_empty()');
    const contract = srcOf('docs/yuko_recruit_docs/18_EXTERNAL_AGENT_CONTRACT.md');
    expect(contract, '契約に「できた回にも出る」が無い').toContain('できた回（`0`）にも、知らせ・注意が出ることがあります');
    expect(contract, '契約に「書き出した動画は出来ている（終了コード0）」が無い').toContain('**書き出した動画は出来ています**（終了コード `0`）');
    // ⚠️ **閉じる前に出す**＝`std::process::exit` の後に置くと、一生出ない。
    expect(
      body.indexOf('eprintln!("{m}")') < body.indexOf('std::process::exit(code)'),
      '文を出す前に落ちている',
    ).toBe(true);
  });
});

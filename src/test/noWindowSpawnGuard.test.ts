// 外部プログラムを**コンソール窓を出さずに**起こしていることの門番（#1107）。
//
// ⚠️ **これは「直したことを将来も確認する手段」**＝以前 VOICEVOX にだけ抑止を入れ、ffmpeg の4か所が
// 漏れていた（`git log -S "creation_flags"` に出るのは VOICEVOX の1件だけ）。書き出しは場面ごとの
// エンコードに加えて結合・字幕・BGM でも起こすので、漏れると**1回の書き出しで何度も窓がちらつく**。
//
// ⚠️ **同じ1行を各所に書き足す形だと、次に足された5か所目が必ず漏れる**＝入口を1つ
// （`src-tauri/src/proc.rs` の `no_window_command`）にして、**それ以外が直に起こしていない**ことを見る。
//
// ⚠️ **フラグが効いていることまでは見られない**（`Command` に取り出す API が無い）＝ここが見るのは
// ①入口以外が直に起こしていない ②入口が抑止の行を持っている ③入口を通る数、の3つ。
// **実際に窓が出ないこと自体は packaged の実機でしか確かめられない**（#1107 に未検証として残す）。
//
// ⚠️ **門番自身にも穴が空く**（α-7 で20件）＝いまのコードがたまたま正しい間は、規則を壊しても
// 緑のままになりうる。だから拾い方（注記・文字列を落とす所）は**純粋関数に出し**、
// 下の「門番自身の検査」で**わざと壊した入力**を通して、見つけることまで固定する。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Rust のソースの置き場。 */
const RUST_DIR = join('src-tauri', 'src');
/** 外部プログラムを起こしてよい**唯一の**入口。 */
const ENTRY = 'proc.rs';

/**
 * 入口を通る呼び出しの**実数**（ファイルごと）。
 *
 * ⚠️ **数で留める**＝「1か所へ寄せた」は、片方が残っていても書けてしまう（`CLAUDE.md` §7）。
 * 増減したらここが赤くなるので、**寄せ忘れ**も**新しい呼び出し**もその場で見える。
 */
const CALL_SITES: Record<string, number> = {
  'ffmpeg.rs': 4,
  'voicevox_engine.rs': 1,
};

/** 外部プログラムを直に起こす書き方。 */
const DIRECT_SPAWN = /\bCommand::new\s*\(/;
/** 入口を通す書き方。 */
const VIA_ENTRY = /\bno_window_command\s*\(/g;
/** 入口が持っていなければならない抑止の行。 */
const SUPPRESSION = /\bcreation_flags\s*\(\s*CREATE_NO_WINDOW\s*\)/;

/**
 * Rust のソースから**注記と文字列の中身**を落とす（行数は保つ）。
 *
 * ⚠️ **注記の中の語で赤くしない**＝門番が誤検出すると信用を落とす
 * （`// Command::new を直に呼ばない` と書いた瞬間に落ちる門番は使えない）。
 * ⚠️ **文字列の中も落とす**＝`"http://127.0.0.1"` の `//` を行注記と取り違えると、
 * **その行の残りが見えなくなる**（見落とす側に倒れる）。
 * ⚠️ **`'"'` のような文字リテラルを飛ばす**＝この repo に実在し（`ffmpeg.rs` の禁止文字の判定）、
 * 素通しすると中の `"` から**文字列が始まったことになって以降が全部消える**。
 */
export function stripRustCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      while (i < src.length && src[i] !== '\n') i += 1; // 改行は次の周でそのまま写す
      continue;
    }
    if (two === '/*') {
      let depth = 1; // Rust のブロック注記は入れ子になれる
      i += 2;
      while (i < src.length && depth > 0) {
        if (src.slice(i, i + 2) === '/*') { depth += 1; i += 2; continue; }
        if (src.slice(i, i + 2) === '*/') { depth -= 1; i += 2; continue; }
        if (src[i] === '\n') out += '\n';
        i += 1;
      }
      continue;
    }
    if (src[i] === '"') {
      i += 1;
      out += '""';
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\n') out += '\n'; // 複数行にまたがる文字列でも行数を保つ
        i += src[i] === '\\' ? 2 : 1;
      }
      i += 1;
      continue;
    }
    const charLit = /^'(?:\\.|[^\\'])'/.exec(src.slice(i, i + 4));
    if (charLit) {
      out += "''";
      i += charLit[0].length;
      continue;
    }
    out += src[i];
    i += 1;
  }
  return out;
}

/** 落とした後のソースから、当たった行を `行番号: 中身` で拾う。 */
export function hits(src: string, re: RegExp): string[] {
  return stripRustCommentsAndStrings(src)
    .split('\n')
    .map((line, n) => ({ line: line.trim(), n: n + 1 }))
    .filter(({ line }) => re.test(line))
    .map(({ line, n }) => `${n}: ${line}`);
}

function rustFiles(): string[] {
  return readdirSync(RUST_DIR).filter((f) => f.endsWith('.rs'));
}

const read = (f: string): string => readFileSync(join(RUST_DIR, f), 'utf-8');

describe('外部プログラムはコンソール窓を出さずに起こす（#1107）', () => {
  it('入口（proc.rs）以外は、外部プログラムを直に起こさない', () => {
    const offenders: string[] = [];
    for (const f of rustFiles()) {
      if (f === ENTRY) continue;
      for (const h of hits(read(f), DIRECT_SPAWN)) offenders.push(`${f} ${h}`);
    }
    // 直に起こすと、その1回ぶんだけ黒い窓が開いて消える。入口（`proc::no_window_command`）を通すこと。
    expect(offenders).toEqual([]);
  });

  it('入口は、コンソール窓の抑止を持っている', () => {
    expect(hits(read(ENTRY), SUPPRESSION)).toHaveLength(1);
  });

  it('入口を通る呼び出しは、数まで合っている', () => {
    const counted: Record<string, number> = {};
    for (const f of rustFiles()) {
      if (f === ENTRY) continue;
      const n = (stripRustCommentsAndStrings(read(f)).match(VIA_ENTRY) ?? []).length;
      if (n > 0) counted[f] = n;
    }
    expect(counted).toEqual(CALL_SITES);
  });
});

describe('門番自身の検査（わざと壊した入力）', () => {
  it('行の注記に書かれた語では赤くならない', () => {
    expect(hits('// Command::new を直に呼ばない\nlet a = 1;\n', DIRECT_SPAWN)).toEqual([]);
  });

  it('行末の注記に書かれた語でも赤くならない', () => {
    expect(hits('let a = 1; // ここは Command::new( を使わない\n', DIRECT_SPAWN)).toEqual([]);
  });

  it('ブロックの注記に書かれた語では赤くならない', () => {
    expect(hits('/* Command::new( */\nlet a = 1;\n', DIRECT_SPAWN)).toEqual([]);
  });

  it('入れ子のブロック注記は、閉じ切るまで注記として扱う', () => {
    // ⚠️ **語を内側の `*/` の後ろに置く**＝手前に置くと、入れ子を数えなくても同じ結果になり、
    // 「入れ子を見ている」ことを**確かめられない**（変異チェックで生き残った）。
    expect(hits('/* 外 /* 内 */ let out = Command::new(bin); */\nlet a = 1;\n', DIRECT_SPAWN)).toEqual([]);
  });

  it('文字列の中の語では赤くならない', () => {
    expect(hits('let s = "Command::new(";\n', DIRECT_SPAWN)).toEqual([]);
  });

  it('本物の呼び出しは、行番号つきで拾う', () => {
    expect(hits('// 注記\nlet out = Command::new(bin);\n', DIRECT_SPAWN))
      .toEqual(['2: let out = Command::new(bin);']);
  });

  it('文字列の中の // で、その行の残りを見落とさない', () => {
    // ⚠️ ここが素通しだと `format!("http://…")` のある行以降を丸ごと見落とす。
    const src = 'let u = "http://127.0.0.1"; let out = Command::new(bin);\n';
    expect(hits(src, DIRECT_SPAWN)).toEqual(['1: let u = ""; let out = Command::new(bin);']);
  });

  it("引用符そのものの文字リテラル（'\"'）で、以降を丸ごと落とさない", () => {
    // ⚠️ `ffmpeg.rs` の禁止文字の判定に実在する形。素通しすると以降が全部「文字列の中」になる。
    const src = "if matches!(c, '\"') { }\nlet out = Command::new(bin);\n";
    expect(hits(src, DIRECT_SPAWN)).toEqual(['2: let out = Command::new(bin);']);
  });

  it('複数行にまたがる文字列でも、行番号がずれない', () => {
    const src = 'let s = "1行目\n2行目";\nlet out = Command::new(bin);\n';
    expect(hits(src, DIRECT_SPAWN)).toEqual(['3: let out = Command::new(bin);']);
  });

  it('注記の外にある本物は、注記に囲まれていても拾う', () => {
    const src = '/* 前 */ let out = Command::new(bin); // 後\n';
    expect(hits(src, DIRECT_SPAWN)).toEqual(['1: let out = Command::new(bin);']);
  });
});

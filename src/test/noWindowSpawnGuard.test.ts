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
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
// ⚠️ **拾い方は1か所**（`src/test/rustSource.ts`）＝画面へ返す文を見る門番
// （`rustUserMessageGuard.test.ts`）も同じものを使う。別々に書いたら、片方だけが
// **文字リテラル `'"'` で対応が反転する**罠を踏んだ（#1111）。
import { stripRustCommentsAndStrings } from './rustSource';

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

/** 外部プログラムを直に起こす書き方（空白を挟まれても拾う）。 */
const DIRECT_SPAWN = /\bCommand\s*::\s*new\s*\(/;
/** 入口を通す書き方。 */
const VIA_ENTRY = /\bno_window_command\s*\(/g;
/** 入口が持っていなければならない抑止の行。 */
const SUPPRESSION = /\bcreation_flags\s*\(\s*CREATE_NO_WINDOW\s*\)/;
/**
 * そのフラグの**値**（Windows の `CREATE_NO_WINDOW`）。
 *
 * ⚠️ **呼び名だけ見ても足りない**＝値を別の数に書き換えても、`creation_flags(CREATE_NO_WINDOW)`
 * という行はそのまま残るので、名前だけ見る検査は緑のままになる。
 */
const FLAG_VALUE = /const\s+CREATE_NO_WINDOW\s*:\s*u32\s*=\s*0x0800_0000\s*;/;
/**
 * `creation_flags` の呼び出し（**入口の外に1つも無い**こと）。
 *
 * ⚠️ **このフラグは足し算ではなく上書き**＝`no_window_command(bin).creation_flags(X)` と書かれた
 * 時点で `CREATE_NO_WINDOW` が**消える**。入口が持っていることだけを見ても、外から消せてしまう。
 */
const ANY_CREATION_FLAGS = /\bcreation_flags\s*\(/;
/**
 * `std::process::Command` の取り込み（**入口の外に1つも無い**こと）。
 *
 * ⚠️ **別名にされると直呼びが見えない**＝`use std::process::Command as Cmd;` と書かれると
 * `Command::new(` の形では拾えない。取り込みごと禁じれば、その道はふさがる。
 */
const COMMAND_IMPORT = /use\s+std::process::(?:\{[^}]*\bCommand\b[^}]*\}|Command\b)/;

/**
 * 抑止の行が**どの `#[cfg(...)]` の側にあるか**を返す（無ければ `null`）。
 *
 * ⚠️ **これを見ないと、いちばん効く壊し方が素通りする**＝`#[cfg(windows)]` と
 * `#[cfg(not(windows))]` を**入れ替える**と、Windows では中身が空の方が呼ばれて抑止が
 * 丸ごと効かなくなる（＝この修正が直したはずの黒い窓がそのまま戻る）のに、
 * `creation_flags(CREATE_NO_WINDOW)` という行は**1つのまま**なので、数を見る検査は緑のまま。
 * `cargo check` も `clippy` も、どちらの枝も実在するので何も言わない。
 */
export function cfgOwningSuppression(src: string): string | null {
  const lines = stripRustCommentsAndStrings(src).split('\n');
  const at = lines.findIndex((l) => SUPPRESSION.test(l));
  if (at < 0) return null;
  for (let i = at; i >= 0; i -= 1) {
    const m = /^#\[cfg\((.+)\)\]$/.exec(lines[i].trim());
    if (m) return m[1];
  }
  return null;
}

/** 落とした後のソースから、当たった行を `行番号: 中身` で拾う。 */
export function hits(src: string, re: RegExp): string[] {
  return stripRustCommentsAndStrings(src)
    .split('\n')
    .map((line, n) => ({ line: line.trim(), n: n + 1 }))
    .filter(({ line }) => re.test(line))
    .map(({ line, n }) => `${n}: ${line}`);
}

/**
 * `src-tauri/src` 以下の `.rs` を**再帰で**集める（返すのは `src-tauri/src` からの相対パス）。
 *
 * ⚠️ **直下だけ見ると、規則を壊しても緑のままになる**（レビュー 🟡）＝いまは平坦なので正しく動くが、
 * 将来 `src-tauri/src/<何か>/foo.rs` が増えると、そこの直呼びは**3つの検査すべてを素通り**する
 * （拾われないので `Command::new` の検査にも、数の検査にも出てこない）。
 * 既存の門番（`layerTypeLiteralGuard.test.ts`）と同じ再帰の流儀に合わせる。
 */
export function rustFiles(dir: string = RUST_DIR, root: string = RUST_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return rustFiles(p, root);
    if (!e.name.endsWith('.rs')) return [];
    return [relative(root, p).split(sep).join('/')];
  });
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

  it('入口が渡すフラグの値が、CREATE_NO_WINDOW のまま', () => {
    expect(hits(read(ENTRY), FLAG_VALUE)).toHaveLength(1);
  });

  it('抑止は Windows の側に置かれている', () => {
    // ⚠️ `#[cfg(windows)]` と `#[cfg(not(windows))]` を入れ替えると、Windows では中身が空の方が
    // 呼ばれて抑止が丸ごと効かなくなるのに、抑止の**行の数は変わらない**（レビュー 🟡）。
    expect(cfgOwningSuppression(read(ENTRY))).toBe('windows');
  });

  it('入口以外は creation_flags を呼ばない（あとから上書きされると抑止が消える）', () => {
    const offenders: string[] = [];
    for (const f of rustFiles()) {
      if (f === ENTRY) continue;
      for (const h of hits(read(f), ANY_CREATION_FLAGS)) offenders.push(`${f} ${h}`);
    }
    expect(offenders).toEqual([]);
  });

  it('入口以外は Command を取り込まない（別名にされると直呼びが見えない）', () => {
    const offenders: string[] = [];
    for (const f of rustFiles()) {
      if (f === ENTRY) continue;
      for (const h of hits(read(f), COMMAND_IMPORT)) offenders.push(`${f} ${h}`);
    }
    expect(offenders).toEqual([]);
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
    // ⚠️ **中身は空白で埋める**（長さと行を保つ＝元のソースと同じ座標で読める・#1111）。
    const [line] = hits(src, DIRECT_SPAWN);
    expect(line).toMatch(/^1: let u = +; let out = Command::new\(bin\);$/);
    expect(line).not.toContain('http');
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

  it('置き場の下にフォルダがあっても、その中の .rs を集める', () => {
    // ⚠️ **直下だけ見る形だと、ここが通らない**＝将来サブフォルダへ移した瞬間、
    // 3つの検査すべてが素通りする（拾われないので、数の検査にも出てこない・レビュー 🟡）。
    const root = mkdtempSync(join(tmpdir(), 'stario-guard-'));
    try {
      writeFileSync(join(root, 'a.rs'), '');
      mkdirSync(join(root, 'deep', 'er'), { recursive: true });
      writeFileSync(join(root, 'deep', 'er', 'b.rs'), '');
      writeFileSync(join(root, 'deep', 'note.txt'), '');
      expect(rustFiles(root, root).sort()).toEqual(['a.rs', 'deep/er/b.rs']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('抑止がどちらの cfg の側にあるかを見分ける', () => {
    const body = 'fn h(c: &mut Command) {\n    c.creation_flags(CREATE_NO_WINDOW);\n}\n';
    expect(cfgOwningSuppression(`#[cfg(windows)]\n${body}`)).toBe('windows');
    expect(cfgOwningSuppression(`#[cfg(not(windows))]\n${body}`)).toBe('not(windows)');
    expect(cfgOwningSuppression('fn h() {}\n')).toBeNull();
  });

  it('空白を挟んだ直呼びも拾う', () => {
    expect(hits('let out = Command :: new (bin);\n', DIRECT_SPAWN))
      .toEqual(['1: let out = Command :: new (bin);']);
  });

  it('注記の外にある本物は、注記に囲まれていても拾う', () => {
    const src = '/* 前 */ let out = Command::new(bin); // 後\n';
    expect(hits(src, DIRECT_SPAWN)).toEqual(['1: let out = Command::new(bin);']);
  });
});

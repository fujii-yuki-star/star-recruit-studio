// 同梱のローカル AI（ADR-0051）のライセンス告知が、配る物と食い違っていないか（#1289）。
//
// ⚠️ **告知は配布の条件**＝MIT・Apache-2.0 は「本文を添える」、Apache-2.0 §4(b) は「改変した旨を告げる」を求める。
//   モデルを作り直した（量子化をやり直した・版を上げた）のに告知だけ古いまま、を作らない。
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LOCAL_AI_LICENSE_DIR } from '../app/screens/AboutScreen';

const ROOT = join(__dirname, '..', '..');
const DIR = join(ROOT, 'src-tauri', 'resources', ...LOCAL_AI_LICENSE_DIR.split('/'));
const readme = () => readFileSync(join(DIR, 'README.txt'), 'utf8');
const rustConst = (name: string): string => {
  const m = readFileSync(join(ROOT, 'src-tauri', 'src', 'local_llm.rs'), 'utf8').match(new RegExp(`pub const ${name}: &str = "([^"]+)"`));
  if (!m) throw new Error(`local_llm.rs に ${name} がありません`);
  return m[1];
};

describe('同梱のローカル AI のライセンス告知（#1289）', () => {
  it('告知のフォルダが About の示す場所にあり、README がある', () => {
    expect(existsSync(DIR), `${LOCAL_AI_LICENSE_DIR} がありません`).toBe(true);
    expect(existsSync(join(DIR, 'README.txt'))).toBe(true);
  });

  it('README が挙げた本文はすべて在って空でない／フォルダの本文はすべて README に載っている', () => {
    const text = readme();
    const named = [...text.matchAll(/→ ([^\s]+\.txt)/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThanOrEqual(9);
    for (const f of named) {
      expect(existsSync(join(DIR, f)), `README が挙げた ${f} がありません`).toBe(true);
      expect(statSync(join(DIR, f)).size, `${f} が空です`).toBeGreaterThan(100);
    }
    const files = readdirSync(DIR).filter((f) => f.endsWith('.txt') && f !== 'README.txt');
    for (const f of files) expect(named, `${f} が README に載っていません`).toContain(f);
  });

  it('改変の告知が、同梱するモデルのファイル名と SHA-256 に一致する（作り直したら告知も直す）', () => {
    const text = readme();
    expect(text).toContain('Notice of modification');
    for (const [file, sha] of [['MODEL_FILE', 'MODEL_SHA256'], ['MMPROJ_FILE', 'MMPROJ_SHA256']]) {
      expect(text, `${file} が告知にありません`).toContain(rustConst(file));
      expect(text, `${sha} が告知と食い違っています`).toContain(rustConst(sha));
    }
  });

  it('実行の部品の版が、作り方の記録（local-llm-build.md）と同じ', () => {
    const build = readFileSync(join(ROOT, 'docs', 'yuko_recruit_docs', 'local-llm-build.md'), 'utf8');
    const tag = build.match(/llama\.cpp `(b\d+)`/)?.[1];
    expect(tag, 'local-llm-build.md に llama.cpp の版がありません').toBeDefined();
    expect(readme()).toContain(`llama.cpp / ggml（${tag}`);
  });

  // ⚠️ **git 自身に聞く**＝.gitignore の文字を見るだけだと、`!LICENSES/` を消しても `!LICENSES/**` が残って緑になった（変異チェック）。
  //   実際はフォルダ自体が `*` で外れて中身も追跡されない＝配布物から告知が消える。
  it('本文は配布物として追跡される（git が外していない）', () => {
    for (const f of ['README.txt', 'llama.cpp-MIT.txt', 'Qwen3.5-Apache-2.0.txt']) {
      const rel = join('src-tauri', 'resources', ...LOCAL_AI_LICENSE_DIR.split('/'), f);
      const r = spawnSync('git', ['check-ignore', '-q', '--no-index', rel], { cwd: ROOT });
      expect(r.status, `${rel} が .gitignore で外れています`).toBe(1); // 1＝外れていない
    }
  });
});

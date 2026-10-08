// 同梱の「声を文字にする」部品（ADR-0058）のライセンス告知が、配る物と食い違っていないか。
//
// ⚠️ **告知は配布の条件**＝MIT は「本文を添える」を求める。モデルや部品の版を上げたのに告知だけ古いまま、を作らない
//   （`localAiLicenseGuard` と同じ守り）。
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { TRANSCRIBE_LICENSE_DIR } from '../app/screens/AboutScreen';

const ROOT = join(__dirname, '..', '..');
const DIR = join(ROOT, 'src-tauri', 'resources', ...TRANSCRIBE_LICENSE_DIR.split('/'));
const readme = () => readFileSync(join(DIR, 'README.txt'), 'utf8');
const rustConst = (name: string): string => {
  const m = readFileSync(join(ROOT, 'src-tauri', 'src', 'transcribe.rs'), 'utf8').match(new RegExp(`pub const ${name}: &str = "([^"]+)"`));
  if (!m) throw new Error(`transcribe.rs に ${name} がありません`);
  return m[1];
};

describe('同梱の「声を文字にする」部品のライセンス告知（ADR-0058）', () => {
  it('README が挙げた本文はすべて在って空でない／フォルダの本文はすべて README に載っている', () => {
    const named = [...readme().matchAll(/→ ([^\s]+\.txt)/g)].map((m) => m[1]);
    expect(named).toEqual(['openai-whisper-MIT.txt', 'whisper.cpp-MIT.txt']);
    for (const f of named) expect(statSync(join(DIR, f)).size, `${f} が空です`).toBeGreaterThan(100);
    const files = readdirSync(DIR).filter((f) => f.endsWith('.txt') && f !== 'README.txt');
    for (const f of files) expect(named, `${f} が README に載っていません`).toContain(f);
  });

  it('告知が、同梱するモデルのファイル名と SHA-256 に一致する（入れ替えたら告知も直す）', () => {
    expect(readme()).toContain(`models/${rustConst('MODEL_FILE')}`);
    expect(readme()).toContain(`SHA-256: ${rustConst('MODEL_SHA256')}`);
  });

  it('置くスクリプトは、照合の値を transcribe.rs から読む（写さない＝置く側と使う側で食い違わない）', () => {
    const place = readFileSync(join(ROOT, 'scripts', 'transcribe', 'place-bundle.sh'), 'utf8');
    expect(place).toContain("grep -o 'MODEL_SHA256: &str = \"[^\"]*\"' src-tauri/src/transcribe.rs");
    expect(place).not.toContain(rustConst('MODEL_SHA256'));
  });

  // ⚠️ **git 自身に聞く**（`localAiLicenseGuard` と同じ理由＝.gitignore の文字だけ見ると、外れていても緑になる）。
  it('本文は配布物として追跡され、部品とモデルは追跡されない', () => {
    const ignored = (rel: string): boolean => spawnSync('git', ['check-ignore', '-q', '--no-index', rel], { cwd: ROOT }).status === 0;
    for (const f of ['README.txt', 'whisper.cpp-MIT.txt', 'openai-whisper-MIT.txt']) {
      expect(ignored(join('src-tauri', 'resources', ...TRANSCRIBE_LICENSE_DIR.split('/'), f)), `${f} が .gitignore で外れています`).toBe(false);
    }
    expect(ignored(join('src-tauri', 'resources', 'transcribe', 'models', rustConst('MODEL_FILE')))).toBe(true);
    expect(ignored(join('src-tauri', 'resources', 'transcribe', 'runtime', 'whisper-cli.exe'))).toBe(true);
    expect(existsSync(join(ROOT, 'src-tauri', 'resources', 'transcribe', 'runtime', '.gitignore'))).toBe(true);
  });
});

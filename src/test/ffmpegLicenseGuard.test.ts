// 同梱の FFmpeg の中に含む部品の告知が、配る物に入っているか（#1241）。
//
// ⚠️ **同梱の FFmpeg（bin・LICENSE.txt）は git の外**＝手で置くので、告知もそこに置くと**置き忘れても気づけない**。
//   告知（OpenH264＝BSD-2-Clause・GPL v3 本文）は `LICENSES/` に置いて git で持つ。
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { FFMPEG_LICENSE_DIR } from '../app/screens/AboutScreen';

const ROOT = join(__dirname, '..', '..');
const DIR = join(ROOT, 'src-tauri', 'resources', ...FFMPEG_LICENSE_DIR.split('/'));

describe('同梱の FFmpeg の告知（#1241）', () => {
  it('About の示す場所に README と本文がある', () => {
    expect(existsSync(join(DIR, 'README.txt')), `${FFMPEG_LICENSE_DIR}/README.txt がありません`).toBe(true);
    const readme = readFileSync(join(DIR, 'README.txt'), 'utf8');
    for (const f of ['GPL-3.0.txt', 'OpenH264-BSD-2-Clause.txt']) {
      expect(readme, `README に ${f} が載っていません`).toContain(f);
      expect(existsSync(join(DIR, f)), `${f} がありません`).toBe(true);
    }
  });

  it('本文の中身が正しい（BSD-2-Clause の Cisco の著作権表示・GPL v3 の本文）', () => {
    const bsd = readFileSync(join(DIR, 'OpenH264-BSD-2-Clause.txt'), 'utf8');
    expect(bsd).toContain('Copyright (c) 2013, Cisco Systems');
    expect(bsd).toContain('Redistributions in binary form must reproduce the above copyright notice');
    const gpl = readFileSync(join(DIR, 'GPL-3.0.txt'), 'utf8');
    expect(gpl).toMatch(/GNU GENERAL PUBLIC LICENSE\s+Version 3, 29 June 2007/);
    expect(gpl).toContain('END OF TERMS AND CONDITIONS');
  });

  // ⚠️ **git 自身に聞く**（`localAiLicenseGuard` と同じ理由）＝`.gitignore` の `*` で外れると配布物から消える。
  it('本文は配布物として追跡される（git が外していない）', () => {
    for (const f of ['README.txt', 'GPL-3.0.txt', 'OpenH264-BSD-2-Clause.txt']) {
      const rel = join('src-tauri', 'resources', ...FFMPEG_LICENSE_DIR.split('/'), f);
      const r = spawnSync('git', ['check-ignore', '-q', '--no-index', rel], { cwd: ROOT });
      expect(r.status, `${rel} が .gitignore で外れています`).toBe(1);
    }
  });
});

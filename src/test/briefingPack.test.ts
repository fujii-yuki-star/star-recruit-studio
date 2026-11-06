// 社内配布用の拡張パック「あなた向け会社説明」（ADR-0060・0061）の元（`packs/personalized-briefing/pack/manifest.json`）。
// ⚠️ 配るものなので、アプリと同じ読み方で読めること・鍵が入っていること・作る命令の出力名が版と合っていることを留める。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePackManifest } from '../domain/pack/extensionPack';
import { PACK_FEATURE } from '../domain/pack/extensionPack';
import { validateExtensionPack } from '../domain/validation/generated/validators.js';

const raw = readFileSync('packs/personalized-briefing/pack/manifest.json', 'utf8');

describe('配布用の拡張パック「あなた向け会社説明」', () => {
  it('正典の形を満たし、アプリと同じ読み方で読め、機能の鍵だけが入っている', () => {
    // `files` は作る道具が埋める＝元には無い。読むときと同じ形にして確かめる。
    const withFiles = { ...JSON.parse(raw), files: [] };
    expect(validateExtensionPack(withFiles)).toBe(true);
    const r = parsePackManifest(JSON.stringify(withFiles));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.contents.features).toEqual([PACK_FEATURE.personalizedBriefing]);
    expect(Object.keys(r.manifest.contents)).toEqual(['features']);
  });

  it('作る命令の出力名が、パックの名前と版に合っている（版を上げたら命令も直す）', () => {
    const m = JSON.parse(raw) as { packId: string; version: string };
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['pack:briefing']).toContain(`release/${m.packId}_${m.version}.starpack`);
  });

  it('使えるアプリの版は、アプリの版以下（β のアプリに入る）', () => {
    const m = JSON.parse(raw) as { minAppVersion: string };
    const app = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as { version: string };
    const n = (v: string): number[] => v.split('.').map(Number);
    const [a, b] = [n(m.minAppVersion), n(app.version)];
    expect(a[0] * 1e6 + a[1] * 1e3 + a[2]).toBeLessThanOrEqual(b[0] * 1e6 + b[1] * 1e3 + b[2]);
  });
});

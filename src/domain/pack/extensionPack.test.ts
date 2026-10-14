// 拡張パック（ADR-0060）の manifest・版・名前空間。
import { describe, expect, it } from 'vitest';
import {
  PACK_PROBLEM,
  compareVersions,
  countPackTemplateUses,
  enabledFeatures,
  isPackScopedId,
  packIdOfScopedId,
  packIdPrefix,
  packInstallProblem,
  parsePackManifest,
  readPackTemplate,
  type ExtensionPackManifest,
} from './extensionPack';

const SHA = 'a'.repeat(64);
const manifest = (over: Partial<ExtensionPackManifest> = {}): ExtensionPackManifest => ({
  schemaVersion: '1.0',
  packId: 'office_looks',
  name: 'オフィスの見た目',
  version: '1.2.0',
  publisher: 'すたりお開発チーム',
  minAppVersion: '0.5.3',
  contents: { templates: [{ file: 'templates/intro.json' }], templateAssets: [{ assetId: 'logo', file: 'assets/logo.png' }] },
  files: [{ path: 'templates/intro.json', sha256: SHA }, { path: 'assets/logo.png', sha256: SHA }],
  licenses: [{ target: 'templates', license: '社内利用', credit: 'すたりお開発チーム' }, { target: 'templateAssets', license: '社内利用' }],
  ...over,
});

describe('parsePackManifest', () => {
  it('形と約束が合えば読める', () => {
    const r = parsePackManifest(JSON.stringify(manifest()));
    expect(r.ok && r.manifest.packId).toBe('office_looks');
  });

  it('JSON でない・schema に合わない（中身が空・プログラムの種類・パスに ..）は断る', () => {
    expect(parsePackManifest('{')).toEqual({ ok: false, problem: { kind: PACK_PROBLEM.invalid } });
    expect(parsePackManifest(JSON.stringify(manifest({ contents: {} })))).toEqual({ ok: false, problem: { kind: PACK_PROBLEM.invalid } });
    expect(parsePackManifest(JSON.stringify({ ...manifest(), contents: { scripts: [{ file: 'a.js' }] } }))).toEqual({ ok: false, problem: { kind: PACK_PROBLEM.invalid } });
    const escape = manifest({ files: [{ path: '../evil.json', sha256: SHA }] });
    expect(parsePackManifest(JSON.stringify(escape))).toEqual({ ok: false, problem: { kind: PACK_PROBLEM.invalid } });
    expect(parsePackManifest(JSON.stringify(manifest({ files: [{ path: '/abs.json', sha256: SHA }] })))).toEqual({ ok: false, problem: { kind: PACK_PROBLEM.invalid } });
  });

  it('packId に __ を含めない（中の id の境目が割れる）', () => {
    expect(parsePackManifest(JSON.stringify(manifest({ packId: 'a__b' })))).toEqual({ ok: false, problem: { kind: PACK_PROBLEM.invalid } });
  });

  it('中身のファイルが照合の一覧に無ければ断る', () => {
    const m = manifest({ files: [{ path: 'templates/intro.json', sha256: SHA }] });
    expect(parsePackManifest(JSON.stringify(m))).toEqual({ ok: false, problem: { kind: PACK_PROBLEM.unlistedContent, path: 'assets/logo.png' } });
  });

  it('中身の種類に権利が書かれていなければ断る', () => {
    const m = manifest({ licenses: [{ target: 'templates', license: '社内利用' }] });
    expect(parsePackManifest(JSON.stringify(m))).toEqual({ ok: false, problem: { kind: PACK_PROBLEM.missingLicense, target: 'templateAssets' } });
  });

  it('機能の鍵だけのパックも読める（権利の欄は要る）', () => {
    const m = manifest({ contents: { features: ['personalized-briefing'] }, files: [], licenses: [{ target: 'features', license: '社内利用' }] });
    expect(parsePackManifest(JSON.stringify(m)).ok).toBe(true);
  });
});

describe('版と入れてよいか', () => {
  it('compareVersions は数として比べる', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.5.2', '0.5.3')).toBeLessThan(0);
  });
  it('アプリが古い・入っている版より古いなら断る・同じ版の入れ直しは許す', () => {
    expect(packInstallProblem(manifest(), '0.5.2', null)).toEqual({ kind: PACK_PROBLEM.appTooOld, minAppVersion: '0.5.3' });
    expect(packInstallProblem(manifest(), '0.5.3', '1.3.0')).toEqual({ kind: PACK_PROBLEM.olderThanInstalled, installedVersion: '1.3.0' });
    expect(packInstallProblem(manifest(), '0.5.3', '1.2.0')).toBeNull();
    expect(packInstallProblem(manifest(), '0.6.0', '1.1.9')).toBeNull();
  });
});

describe('id の名前空間', () => {
  it('パックの頭で同梱・利用者の id と分かれ、どのパックかを取り出せる', () => {
    expect(packIdPrefix('office_looks')).toBe('pack_office_looks__');
    expect(isPackScopedId('pack_office_looks__intro')).toBe(true);
    expect(isPackScopedId('user_tmpl_001')).toBe(false);
    expect(isPackScopedId('opening_yuko_right_v1')).toBe(false);
    expect(packIdOfScopedId('pack_office_looks__intro_v2')).toBe('office_looks');
    expect(packIdOfScopedId('user_tmpl_001')).toBeNull();
  });
});

describe('readPackTemplate', () => {
  const tmpl = (layers: unknown[]) => JSON.stringify({
    schemaVersion: '1.0', templateId: 'intro', name: '紹介', category: 'opening', aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080 }, layers,
  });
  it('templateId と既定素材の assetId にパックの頭を付ける', () => {
    const t = readPackTemplate('office_looks', tmpl([
      { id: 'bg', type: 'background', x: 0, y: 0, w: 1920, h: 1080, zIndex: 0, fillColor: '#ffffff' },
      { id: 'logo', type: 'logo', x: 10, y: 10, w: 100, h: 100, zIndex: 1, assetId: 'logo' },
    ]), new Set(['logo']));
    expect(t?.templateId).toBe('pack_office_looks__intro');
    expect(t?.layers[1]).toMatchObject({ assetId: 'pack_office_looks__logo' });
    expect(t?.layers[0]).not.toHaveProperty('assetId');
  });
  it('パックに無い既定素材を指す・形が違う見た目パターンは読まない', () => {
    expect(readPackTemplate('office_looks', tmpl([{ id: 'logo', type: 'logo', x: 0, y: 0, w: 1, h: 1, zIndex: 1, assetId: 'other' }]), new Set(['logo']))).toBeNull();
    expect(readPackTemplate('office_looks', '{"templateId":"x"}', new Set())).toBeNull();
    expect(readPackTemplate('office_looks', '{', new Set())).toBeNull();
  });
});

describe('機能の鍵と外す前の数え上げ', () => {
  it('知っている機能だけを有効にする', () => {
    const a = manifest({ contents: { features: ['personalized-briefing', 'future-thing'] } });
    expect([...enabledFeatures([a], ['personalized-briefing'])]).toEqual(['personalized-briefing']);
    expect(enabledFeatures([], ['personalized-briefing']).size).toBe(0);
  });
  it('そのパックの見た目パターンを使う場面だけを数える', () => {
    expect(countPackTemplateUses('office_looks', ['pack_office_looks__a', 'pack_office_looks__b', 'pack_other__a', 'opening_v1'])).toBe(2);
  });
});

describe('パックの外から入る道で、パックの名前を名乗らせない（PR レビュー 🟡）', () => {
  it('templateId か層の既定素材がパックの名前なら templateClaimsPackIds が真', async () => {
    const { templateClaimsPackIds } = await import('./extensionPack');
    const t = (templateId: string, assetId?: string) =>
      ({ templateId, layers: [{ id: 'l', type: 'logo', x: 0, y: 0, w: 1, h: 1, zIndex: 1, ...(assetId ? { assetId } : {}) }] }) as never;
    expect(templateClaimsPackIds(t('pack_office__intro'))).toBe(true);
    expect(templateClaimsPackIds(t('my_look', 'pack_office__logo'))).toBe(true);
    expect(templateClaimsPackIds(t('my_look', 'tmpl_asset_001'))).toBe(false);
    expect(templateClaimsPackIds(t('my_look'))).toBe(false);
  });
});

describe('機能の名前', () => {
  it('知っている名前だけが isKnownPackFeature', async () => {
    const { isKnownPackFeature, KNOWN_PACK_FEATURES } = await import('./extensionPack');
    for (const f of KNOWN_PACK_FEATURES) expect(isKnownPackFeature(f)).toBe(true);
    expect(isKnownPackFeature('future-thing')).toBe(false);
  });
});

describe('文字の形（段階2）', () => {
  const withFonts = (fonts: { fontId: string; file: string; displayName: string }[], over: Partial<ExtensionPackManifest> = {}) =>
    manifest({
      contents: { fonts },
      files: fonts.map((f) => ({ path: f.file, sha256: SHA })),
      licenses: [{ target: 'fonts', license: 'SIL OFL 1.1', credit: '作った人' }],
      ...over,
    });

  it('文字の形を持つパックを読み、動画から指す id を組む', async () => {
    const { packFonts } = await import('./extensionPack');
    const r = parsePackManifest(JSON.stringify(withFonts([{ fontId: 'mincho', file: 'fonts/mincho.otf', displayName: '明朝' }])));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(packFonts([r.manifest])).toEqual([{ id: 'pack_office_looks__mincho', packId: 'office_looks', file: 'fonts/mincho.otf', sha256: SHA, displayName: '明朝' }]);
    // 組み立てた id は文字の形の id の形（schema と同じ規則）に通る＝頭と境目を2か所で書いていても割れていない。
    const { isPackFontId } = await import('../font/fontCatalog');
    expect(isPackFontId(packFonts([r.manifest])[0].id)).toBe(true);
  });

  it('同じ名前の文字の形が2つ・権利が無い・照合の一覧に無い・文字の形でない拡張子は断る', () => {
    const dup = withFonts([
      { fontId: 'mincho', file: 'fonts/a.otf', displayName: 'A' },
      { fontId: 'mincho', file: 'fonts/b.otf', displayName: 'B' },
    ]);
    expect(parsePackManifest(JSON.stringify(dup))).toEqual({ ok: false, problem: { kind: PACK_PROBLEM.invalid } });
    const noLicense = withFonts([{ fontId: 'mincho', file: 'fonts/a.otf', displayName: 'A' }], { licenses: [{ target: 'templates', license: 'x' }] });
    expect(parsePackManifest(JSON.stringify(noLicense))).toEqual({ ok: false, problem: { kind: PACK_PROBLEM.missingLicense, target: 'fonts' } });
    const unlisted = withFonts([{ fontId: 'mincho', file: 'fonts/a.otf', displayName: 'A' }], { files: [] });
    expect(parsePackManifest(JSON.stringify(unlisted))).toEqual({ ok: false, problem: { kind: PACK_PROBLEM.unlistedContent, path: 'fonts/a.otf' } });
    const exe = withFonts([{ fontId: 'mincho', file: 'fonts/a.exe', displayName: 'A' }]);
    expect(parsePackManifest(JSON.stringify(exe))).toEqual({ ok: false, problem: { kind: PACK_PROBLEM.invalid } });
  });

  it('外す前の数え上げは、見た目パターンにも文字の形（種別ごとの上書きを含む）にも効き、よそのパックは数えない', async () => {
    const { projectUsesPack } = await import('./extensionPack');
    expect(projectUsesPack('{"scenes":[{"templateId":"pack_office__intro"}]}', 'office')).toBe(true);
    expect(projectUsesPack('{"videoSettings":{"fontId":"pack_office__mincho"}}', 'office')).toBe(true);
    expect(projectUsesPack('{"clips":[{"textFontIds":{"title": "pack_office__mincho"}}]}', 'office')).toBe(true);
    expect(projectUsesPack('{"videoSettings":{"fontId":"pack_office_looks__mincho"}}', 'office')).toBe(false);
    expect(projectUsesPack('{"videoSettings":{"fontId":"user_font_001"}}', 'office')).toBe(false);
  });
});

describe('音楽（段階2b）', () => {
  const withBgm = (bgm: { bgmId: string; file: string; displayName: string }[], over: Partial<ExtensionPackManifest> = {}) =>
    manifest({
      contents: { bgm },
      files: bgm.map((b) => ({ path: b.file, sha256: SHA })),
      licenses: [{ target: 'bgm', license: 'CC0' }],
      ...over,
    });

  it('音楽を持つパックを読み、棚に並べる id を組む', async () => {
    const { packBgms } = await import('./extensionPack');
    const r = parsePackManifest(JSON.stringify(withBgm([{ bgmId: 'morning', file: 'bgm/morning.mp3', displayName: '朝' }])));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(packBgms([r.manifest])).toEqual([{ id: 'pack_office_looks__morning', packId: 'office_looks', file: 'bgm/morning.mp3', displayName: '朝' }]);
  });

  it('同じ名前の音楽が2つ・権利が無い・照合の一覧に無い・音でない拡張子は断る', () => {
    const b = { bgmId: 'morning', file: 'bgm/a.mp3', displayName: 'A' };
    expect(parsePackManifest(JSON.stringify(withBgm([b, { ...b, file: 'bgm/b.mp3' }])))).toEqual({ ok: false, problem: { kind: PACK_PROBLEM.invalid } });
    expect(parsePackManifest(JSON.stringify(withBgm([b], { licenses: [{ target: 'templates', license: 'x' }] })))).toEqual({ ok: false, problem: { kind: PACK_PROBLEM.missingLicense, target: 'bgm' } });
    expect(parsePackManifest(JSON.stringify(withBgm([b], { files: [] })))).toEqual({ ok: false, problem: { kind: PACK_PROBLEM.unlistedContent, path: 'bgm/a.mp3' } });
    expect(parsePackManifest(JSON.stringify(withBgm([{ ...b, file: 'bgm/a.exe' }])))).toEqual({ ok: false, problem: { kind: PACK_PROBLEM.invalid } });
  });

  /** ⚠️ **同じ並びが Rust にもある**（`is_pack_audio`）＝片方だけ足すと「棚に並ぶのに取り込めない」。schema の pattern も同じ並び。 */
  it('音の拡張子は domain・Rust・schema で同じ並び', async () => {
    const { readFileSync } = await import('node:fs');
    const { AUDIO_FILE_EXTENSIONS } = await import('../asset/assetFile');
    const rs = readFileSync('src-tauri/src/packs.rs', 'utf8');
    const m = /const AUDIO: \[&str; \d+\] = \[([^\]]+)\]/.exec(rs);
    expect(m, 'packs.rs の AUDIO が見つからない').not.toBeNull();
    expect(m![1].split(',').map((s) => s.trim().replace(/"/g, ''))).toEqual([...AUDIO_FILE_EXTENSIONS]);
    const schema = JSON.parse(readFileSync('docs/yuko_recruit_docs/schemas/extension-pack.schema.json', 'utf8'));
    const pat: string = schema.properties.contents.properties.bgm.items.properties.file.allOf[1].pattern;
    expect(pat).toBe(`${String.fromCharCode(92)}.(${AUDIO_FILE_EXTENSIONS.join('|')})$`);
  });
});

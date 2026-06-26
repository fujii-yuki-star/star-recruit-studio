import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FONT_CATALOG, DEFAULT_FONT_ID, fontFamilyForId, cssFamilyForId, isKnownFontId, resolveFontId,
} from './fontCatalog';

describe('fontCatalog（同梱フォント選択）', () => {
  it('既定フォントはカタログに存在する', () => {
    expect(FONT_CATALOG.some((f) => f.id === DEFAULT_FONT_ID)).toBe(true);
  });

  it('カタログの id は project.schema の videoSettings.fontId enum と一致（schema を実読してドリフト検知）', () => {
    const schema = JSON.parse(
      readFileSync(join(process.cwd(), 'docs/yuko_recruit_docs/schemas/project.schema.json'), 'utf8'),
    );
    const schemaEnum: string[] = schema.$defs.VideoSettings.properties.fontId.enum;
    expect([...FONT_CATALOG.map((f) => f.id)].sort()).toEqual([...schemaEnum].sort());
  });

  it('fontFamilyForId：既知IDは cssFamily＋sans-serif、未知/未指定は既定へ', () => {
    const gen = FONT_CATALOG.find((f) => f.id === 'gen-interface-jp')!;
    expect(fontFamilyForId('gen-interface-jp')).toBe(`'${gen.cssFamily}', sans-serif`);
    const def = FONT_CATALOG.find((f) => f.id === DEFAULT_FONT_ID)!;
    expect(fontFamilyForId(undefined)).toBe(`'${def.cssFamily}', sans-serif`);
    expect(fontFamilyForId('unknown-font')).toBe(`'${def.cssFamily}', sans-serif`);
  });

  it('cssFamilyForId：bare family（クォート・フォールバック無し）', () => {
    expect(cssFamilyForId('kaitou-yokoku-gothic')).toBe('Kaitou Yokoku Gothic');
    expect(cssFamilyForId(null)).toBe(FONT_CATALOG.find((f) => f.id === DEFAULT_FONT_ID)!.cssFamily);
  });

  it('isKnownFontId：既知 true・未知/未指定 false', () => {
    expect(isKnownFontId('gen-interface-jp')).toBe(true);
    expect(isKnownFontId('unknown-font')).toBe(false);
    expect(isKnownFontId(undefined)).toBe(false);
  });

  it('resolveFontId：場面 → 動画全体 → 既定 の順で解決（null=継承）', () => {
    expect(resolveFontId('kaitou-yokoku-gothic', 'gen-interface-jp')).toBe('kaitou-yokoku-gothic'); // 場面が既知
    expect(resolveFontId(null, 'gen-interface-jp-display')).toBe('gen-interface-jp-display'); // null=継承→全体
    expect(resolveFontId(undefined, 'gen-interface-jp-display')).toBe('gen-interface-jp-display');
    expect(resolveFontId('bogus', 'kaitou-yokoku-gothic')).toBe('kaitou-yokoku-gothic'); // 未知→全体へ
    expect(resolveFontId(null, null)).toBe(DEFAULT_FONT_ID); // どちらも無ければ既定
    expect(resolveFontId('bogus', 'also-bogus')).toBe(DEFAULT_FONT_ID);
  });

  it('カタログの id は project.schema の scene.fontId enum とも一致（null 継承を許容・ドリフト検知）', () => {
    const schema = JSON.parse(
      readFileSync(join(process.cwd(), 'docs/yuko_recruit_docs/schemas/project.schema.json'), 'utf8'),
    );
    const sceneEnum: unknown[] = schema.$defs.Scene.properties.fontId.enum;
    const sceneIds = sceneEnum.filter((x): x is string => typeof x === 'string');
    expect([...FONT_CATALOG.map((f) => f.id)].sort()).toEqual([...sceneIds].sort());
    expect(sceneEnum).toContain(null); // null=継承（動画全体に合わせる）を許容
  });
});

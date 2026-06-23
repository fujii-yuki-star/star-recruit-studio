import { describe, expect, it } from 'vitest';
import {
  FONT_CATALOG, DEFAULT_FONT_ID, fontFamilyForId, cssFamilyForId, isKnownFontId,
} from './fontCatalog';

describe('fontCatalog（同梱フォント選択）', () => {
  it('既定フォントはカタログに存在する', () => {
    expect(FONT_CATALOG.some((f) => f.id === DEFAULT_FONT_ID)).toBe(true);
  });

  it('カタログの id は project.schema の videoSettings.fontId enum と一致（ドリフト検知）', () => {
    expect([...FONT_CATALOG.map((f) => f.id)].sort()).toEqual(
      ['gen-interface-jp', 'gen-interface-jp-display', 'kaitou-yokoku-gothic'].sort(),
    );
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
});

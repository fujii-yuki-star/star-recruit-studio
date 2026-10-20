import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FONT_CATALOG, DEFAULT_FONT_ID, fontFamilyForId, cssFamilyForId, isKnownFontId, resolveFontId,
  createUserFontId, isUserFontId, USER_FONT_ID_RE, USER_FONT_ID_SAMPLES,
  PACK_FONT_ID_RE, PACK_FONT_ID_SAMPLES, isExternalFontId, isFontAvailable, effectiveTextFontId, boldLooksSameIn,
} from './fontCatalog';

describe('fontCatalog（同梱フォント選択）', () => {
  it('既定フォントはカタログに存在する', () => {
    expect(FONT_CATALOG.some((f) => f.id === DEFAULT_FONT_ID)).toBe(true);
  });

  /**
   * ⚠️ **schema は enum ではなく「形」（pattern）で縛る**（ADR-0038・#261）＝持ち込みフォントは
   * 利用者ごとに増えるので値を数え上げられない。ドリフト検知の狙いは変わらない＝
   * **同梱の id が schema を通り、知らない id は通らない**ことを schema を実読して確かめる。
   */
  it('同梱フォントの id は project.schema の fontId の形に通る（schema を実読してドリフト検知）', () => {
    const schema = JSON.parse(
      readFileSync(join(process.cwd(), 'docs/yuko_recruit_docs/schemas/project.schema.json'), 'utf8'),
    );
    const re = new RegExp(schema.$defs.FontId.pattern);
    for (const f of FONT_CATALOG) expect(re.test(f.id)).toBe(true);
    expect(re.test('user_font_001')).toBe(true); // 持ち込みも通る
    expect(re.test('my-font')).toBe(false); // 知らない形は通らない
    expect(re.test('user_font_1')).toBe(false); // 3桁ゼロ詰め
  });

  /** ⚠️ **schema の形とドメインの正規表現を突き合わせる**＝片方だけ変えると保存できるのに読めない。 */
  it('持ち込みフォントの形は schema と domain で同じ（USER_FONT_ID_RE）', () => {
    const schema = JSON.parse(
      readFileSync(join(process.cwd(), 'docs/yuko_recruit_docs/schemas/project.schema.json'), 'utf8'),
    );
    const re = new RegExp(schema.$defs.FontId.pattern);
    // ⚠️ 入力は**Rust 側と同じ一覧**（`USER_FONT_ID_SAMPLES`）を使う＝3か所が同じ答えになることを
    // 同じ材料で確かめる（α-6 出口監査 🔴5）。同梱の id は schema の `FontId` では通る（enum 側）ので、
    // ここは**持ち込みの形かどうか**だけを突き合わせる。
    for (const id of USER_FONT_ID_SAMPLES.filter((x) => !FONT_CATALOG.some((f) => f.id === x))) {
      expect(USER_FONT_ID_RE.test(id)).toBe(re.test(id));
    }
  });

  /**
   * 拡張パックの文字の形（ADR-0060 段階2）。⚠️ **3つの schema の規則が組み合わさる**＝project の `FontId`・
   * extension-pack の `packId` と `contents.fonts[].fontId`。パックが schema どおりなら、組み立てた id は必ず project の形に通る。
   */
  it('パックの文字の形の id は schema と domain で同じ（PACK_FONT_ID_RE）・パックの規則から組んだ id は必ず通る', () => {
    const read = (f: string) => JSON.parse(readFileSync(join(process.cwd(), 'docs/yuko_recruit_docs/schemas', f), 'utf8'));
    const re = new RegExp(read('project.schema.json').$defs.FontId.pattern);
    for (const id of PACK_FONT_ID_SAMPLES) expect(PACK_FONT_ID_RE.test(id)).toBe(re.test(id));
    expect(PACK_FONT_ID_SAMPLES.filter((id) => re.test(id))).toEqual(['pack_office__mincho', 'pack_office_looks__mincho_bold']);
    const pack = read('extension-pack.schema.json');
    const packIdRe = new RegExp(pack.properties.packId.pattern);
    const fontIdRe = new RegExp(pack.properties.contents.properties.fonts.items.properties.fontId.pattern);
    for (const [p, f] of [['a', 'b'], ['office_looks', 'mincho_bold_2'], ['x1', '9']]) {
      expect(packIdRe.test(p) && fontIdRe.test(f)).toBe(true);
      expect(re.test(`pack_${p}__${f}`)).toBe(true);
    }
  });

  it('同梱でない文字の形（持ち込み・パック）は家族名が id・形で既知・手元の一覧で在るかを見る', () => {
    expect(isExternalFontId('pack_office__mincho')).toBe(true);
    expect(isExternalFontId('user_font_001')).toBe(true);
    expect(isExternalFontId('gen-interface-jp')).toBe(false);
    expect(cssFamilyForId('pack_office__mincho')).toBe('pack_office__mincho');
    expect(isKnownFontId('pack_office__mincho')).toBe(true);
    expect(isFontAvailable('pack_office__mincho', ['pack_office__mincho'])).toBe(true);
    expect(isFontAvailable('pack_office__mincho', ['user_font_001'])).toBe(false);
    expect(isFontAvailable('pack_office__mincho', null)).toBe(true); // 調べていないなら「無い」と言わない
    expect(resolveFontId('pack_office__mincho', null)).toBe('pack_office__mincho');
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

  /**
   * ⚠️ **8か所すべてが同じ定義を指すことを1つずつ確かめる**（PR #886 レビュー）＝
   * 1か所だけ見ていると「一部だけ enum に戻す」誤修正を捕まえられない。
   */
  it('fontId は8か所すべてが共有の定義を指す（片方だけ古い、を防ぐ）', () => {
    const schema = JSON.parse(
      readFileSync(join(process.cwd(), 'docs/yuko_recruit_docs/schemas/project.schema.json'), 'utf8'),
    );
    const textKeys = ['title', 'main', 'subtitle', 'caption', 'url'];
    const sites: [string, unknown, string][] = [
      ['videoSettings.fontId', schema.$defs.VideoSettings.properties.fontId, '#/$defs/FontId'],
      ['Scene.fontId', schema.$defs.Scene.properties.fontId, '#/$defs/FontIdOrNull'],
      ['FreeElement.fontId', schema.$defs.FreeElement.properties.fontId, '#/$defs/FontIdOrNull'],
      ...textKeys.map((k): [string, unknown, string] => [
        `Scene.textFontIds.${k}`,
        schema.$defs.Scene.properties.textFontIds.properties[k],
        '#/$defs/FontId',
      ]),
    ];
    expect(sites).toHaveLength(8);
    for (const [name, node, ref] of sites) {
      expect({ [name]: (node as { $ref?: string }).$ref }).toEqual({ [name]: ref });
      // enum に戻っていないことも明示（`$ref` があっても enum が併記されると値域が狭まる）。
      expect((node as { enum?: unknown }).enum).toBeUndefined();
    }
    const orNull = schema.$defs.FontIdOrNull.oneOf;
    expect(orNull).toContainEqual({ $ref: '#/$defs/FontId' });
    expect(orNull).toContainEqual({ type: 'null' }); // null=継承（動画全体に合わせる）
  });

  describe('持ち込みフォント（ADR-0038・#261）', () => {
    it('形だけを見て持ち込みと判定する（ファイルの有無は別の話）', () => {
      expect(isUserFontId('user_font_001')).toBe(true);
      expect(isUserFontId('gen-interface-jp')).toBe(false);
      expect(isUserFontId('user_font_1')).toBe(false);
      expect(isUserFontId(null)).toBe(false);
    });

    /** ⚠️ **描く側に目録を配らない**（`fontCatalog.ts` の ⚠️）＝家族名は id そのもの。 */
    it('CSS の家族名は id そのもの（目録を引かずに描ける）', () => {
      expect(cssFamilyForId('user_font_001')).toBe('user_font_001');
      expect(fontFamilyForId('user_font_001')).toBe("'user_font_001', sans-serif");
    });

    it('持ち込みは既知として扱う（ファイルが無くても id は壊れていない）', () => {
      expect(isKnownFontId('user_font_001')).toBe(true);
    });

    /** ⚠️ **消した番号は使い回さない**＝古い動画が同じ id で別のフォントを指さない。 */
    it('番号は既存の最大＋1（消した番号を再利用しない）', () => {
      expect(createUserFontId([])).toBe('user_font_001');
      expect(createUserFontId(['user_font_001', 'user_font_003'])).toBe('user_font_004');
      expect(createUserFontId(['gen-interface-jp'])).toBe('user_font_001'); // 同梱は数えない
    });

    it('場面の解決でも持ち込みが選ばれる（継承の順は変わらない）', () => {
      expect(resolveFontId('user_font_001', 'gen-interface-jp')).toBe('user_font_001');
      expect(resolveFontId(null, 'user_font_002')).toBe('user_font_002');
      expect(resolveFontId(null, null)).toBe(DEFAULT_FONT_ID);
    });
  });
});

// 太さの欄の知らせ（#1483・ADR-0038）＝描くときと同じ順で字体を解き、持ち込み・パックの字体なら「太字が効かない」。
describe('effectiveTextFontId / boldLooksSameIn', () => {
  it('要素 → 場面 → 動画全体 → 既定の順（分からない値は飛ばす）', () => {
    expect(effectiveTextFontId('user_font_001', 'gen-interface-jp-display', DEFAULT_FONT_ID)).toBe('user_font_001');
    expect(effectiveTextFontId(undefined, 'gen-interface-jp-display', 'user_font_002')).toBe('gen-interface-jp-display');
    expect(effectiveTextFontId('not-a-font', undefined, 'user_font_002')).toBe('user_font_002');
    expect(effectiveTextFontId(undefined, undefined, undefined)).toBe(DEFAULT_FONT_ID);
  });
  it('持ち込み・拡張パックの字体では太字が効かない／同梱の字体では効く', () => {
    expect(boldLooksSameIn('user_font_001')).toBe(true);
    expect(boldLooksSameIn('pack_office__mincho')).toBe(true);
    expect(boldLooksSameIn(DEFAULT_FONT_ID)).toBe(false);
    expect(boldLooksSameIn(undefined)).toBe(false);
  });
});

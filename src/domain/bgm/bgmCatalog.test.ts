import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BGM_CATALOG, bgmById, isKnownBundledBgmId } from './bgmCatalog';

describe('bgmCatalog（同梱BGM選択）', () => {
  it('全曲が一意な id と .mp3 ファイル名・表示名・クレジットを持つ', () => {
    const ids = BGM_CATALOG.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of BGM_CATALOG) {
      expect(b.fileName).toMatch(/\.mp3$/);
      expect(b.label.length).toBeGreaterThan(0);
      expect(b.title.length).toBeGreaterThan(0);
      expect(b.artist.length).toBeGreaterThan(0);
    }
  });

  it('カタログの id は project.schema の bgmSettings.bundledBgmId enum と一致（schema を実読してドリフト検知）', () => {
    const schema = JSON.parse(
      readFileSync(join(process.cwd(), 'docs/yuko_recruit_docs/schemas/project.schema.json'), 'utf8'),
    );
    const schemaEnum: unknown[] = schema.$defs.BgmSettings.properties.bundledBgmId.enum;
    const schemaIds = schemaEnum.filter((x): x is string => typeof x === 'string');
    expect([...BGM_CATALOG.map((b) => b.id)].sort()).toEqual([...schemaIds].sort());
    // null（標準BGM未選択＝自分のBGM/なし）が許容されていること。
    expect(schemaEnum).toContain(null);
  });

  it('bgmById：既知 id を返し、未知/未指定/null は undefined', () => {
    expect(bgmById('summer-morning')?.title).toBe('Summer Morning');
    expect(bgmById('found-new-hope')?.id).toBe('found-new-hope');
    expect(bgmById('unknown')).toBeUndefined();
    expect(bgmById(null)).toBeUndefined();
    expect(bgmById(undefined)).toBeUndefined();
  });

  it('isKnownBundledBgmId：既知 true・未知/未指定/型違い false', () => {
    expect(isKnownBundledBgmId('limousine-cruise')).toBe(true);
    expect(isKnownBundledBgmId('nope')).toBe(false);
    expect(isKnownBundledBgmId(null)).toBe(false);
    expect(isKnownBundledBgmId(123)).toBe(false);
  });
});

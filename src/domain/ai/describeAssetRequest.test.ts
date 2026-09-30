// 取り込んだ写真を同梱の AI に読ませて説明とタグを付ける（ADR-0052 決定4・12 §4b）。
import { describe, expect, it } from 'vitest';
import { ASSET_AI_TAGS_MAX, ASSET_AI_TAG_MAX_LENGTH, ASSET_DESCRIPTION_MAX_LENGTH } from '../constants';
import type { Asset } from '../project/types';
import {
  DESCRIBE_ASSET_SYSTEM_PROMPT,
  applyAssetDescription,
  buildDescribeAssetMessages,
  describeTarget,
  parseAssetDescription,
} from './describeAssetRequest';

function asset(over: Partial<Asset>): Asset {
  return { assetId: 'asset_001', assetType: 'image', displayName: 'office.jpg', filePath: 'assets/asset_001.jpg', ...over } as Asset;
}

describe('buildDescribeAssetMessages', () => {
  it('説明とタグを字数の上限つきの形で縛る', () => {
    const m = buildDescribeAssetMessages(asset({}));
    expect(m.system).toBe(DESCRIBE_ASSET_SYSTEM_PROMPT);
    expect(m.schema).toEqual({
      type: 'object', additionalProperties: false, required: ['description', 'tags'],
      properties: {
        description: { type: 'string', minLength: 1, maxLength: ASSET_DESCRIPTION_MAX_LENGTH },
        tags: { type: 'array', maxItems: ASSET_AI_TAGS_MAX, items: { type: 'string', minLength: 1, maxLength: ASSET_AI_TAG_MAX_LENGTH } },
      },
    });
  });

  it('ファイル名を手がかりに添え、動画は代表の1コマだと伝える', () => {
    expect(buildDescribeAssetMessages(asset({})).user).toContain('office.jpg');
    expect(buildDescribeAssetMessages(asset({ assetType: 'video' })).user).toContain('動画の代表の1コマ');
  });

  it('推測で固有名詞を書かないよう伝える', () => {
    expect(DESCRIBE_ASSET_SYSTEM_PROMPT).toContain('推測で会社名・人の名前・地名を書かない');
  });
});

describe('parseAssetDescription', () => {
  it('説明とタグを取り出す（前後の空白・重なったタグ・空のタグは落とす）', () => {
    expect(parseAssetDescription(' {"description":" 明るいオフィス ","tags":["オフィス"," 明るい ","オフィス",""]} '))
      .toEqual({ description: '明るいオフィス', tags: ['オフィス', '明るい'] });
  });

  it('タグが無い・配列でないなら空のタグ', () => {
    expect(parseAssetDescription('{"description":"外観"}')).toEqual({ description: '外観', tags: [] });
    expect(parseAssetDescription('{"description":"外観","tags":"x"}')).toEqual({ description: '外観', tags: [] });
  });

  it('上限を越えたタグ・文字でないタグは落とし、数は上限まで', () => {
    const tags = ['あ'.repeat(ASSET_AI_TAG_MAX_LENGTH + 1), 1, 'a', 'b', 'c', 'd', 'e', 'f'];
    expect(parseAssetDescription(JSON.stringify({ description: 'x', tags }))?.tags).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(parseAssetDescription(JSON.stringify({ description: 'x', tags: ['あ'.repeat(ASSET_AI_TAG_MAX_LENGTH)] }))?.tags).toHaveLength(1);
  });

  it('説明が上限を越える・空・文字でない・JSON でないなら付けない', () => {
    expect(parseAssetDescription(JSON.stringify({ description: 'あ'.repeat(ASSET_DESCRIPTION_MAX_LENGTH + 1) }))).toBeNull();
    expect(parseAssetDescription(JSON.stringify({ description: 'あ'.repeat(ASSET_DESCRIPTION_MAX_LENGTH) }))).not.toBeNull();
    expect(parseAssetDescription('{"description":"  "}')).toBeNull();
    expect(parseAssetDescription('{"description":1}')).toBeNull();
    expect(parseAssetDescription('null')).toBeNull();
    expect(parseAssetDescription('説明です')).toBeNull();
  });
});

describe('describeTarget（読むか・どのファイルか）', () => {
  it('写真は本体、動画は代表の1コマ（元の動画ファイルは読まない）', () => {
    expect(describeTarget(asset({}))).toBe('assets/asset_001.jpg');
    expect(describeTarget(asset({ assetType: 'video', filePath: 'assets/a.mp4', thumbnailPath: 'assets/a_thumb.png' }))).toBe('assets/a_thumb.png');
    expect(describeTarget(asset({ assetType: 'video', filePath: 'assets/a.mp4' }))).toBeNull();
  });

  it('もう説明がある素材は読まない（利用者が直した値を上書きしない）', () => {
    expect(describeTarget(asset({ aiDescription: '利用者の説明' }))).toBeNull();
    expect(describeTarget(asset({ aiDescription: '  ' }))).toBe('assets/asset_001.jpg');
  });

  it('ゆうこ・ロゴ・BGM は読まない', () => {
    for (const assetType of ['yuko', 'logo', 'bgm'] as const) expect(describeTarget(asset({ assetType }))).toBeNull();
  });
});

describe('applyAssetDescription（読んだ結果を当てる）', () => {
  const result = { description: '明るいオフィス', tags: ['オフィス'] };

  it('説明を入れ、タグが無ければタグも付ける（元は壊さない）', () => {
    const a = asset({});
    expect(applyAssetDescription(a, result)).toEqual({ ...a, aiDescription: '明るいオフィス', tags: ['オフィス'] });
    expect(a.aiDescription).toBeUndefined();
  });

  it('利用者のタグがあればタグは触らない', () => {
    expect(applyAssetDescription(asset({ tags: ['自分のタグ'] }), result)?.tags).toEqual(['自分のタグ']);
  });

  it('AI のタグが空なら tags を作らない', () => {
    expect('tags' in (applyAssetDescription(asset({}), { description: 'x', tags: [] }) ?? {})).toBe(false);
  });

  it('待っている間に説明が書かれていたら当てない', () => {
    expect(applyAssetDescription(asset({ aiDescription: '書いた' }), result)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { detectAssetType, exceedsInlineAssetLimit, fileExtension } from './assetFile';
import { MAX_INLINE_ASSET_BYTES } from '../constants';

describe('fileExtension', () => {
  it('末尾拡張子を小文字で返す', () => {
    expect(fileExtension('clip.MP4')).toBe('mp4');
    expect(fileExtension('a.b.JPG')).toBe('jpg');
  });
  it('拡張子なし・末尾ドットは空', () => {
    expect(fileExtension('noext')).toBe('');
    expect(fileExtension('trailingdot.')).toBe('');
  });
});

describe('detectAssetType', () => {
  it('動画拡張子は video（大文字も）', () => {
    expect(detectAssetType('intro.mp4')).toBe('video');
    expect(detectAssetType('shot.MOV')).toBe('video');
    expect(detectAssetType('clip.webm')).toBe('video');
    expect(detectAssetType('clip.m4v')).toBe('video');
    expect(detectAssetType('clip.avi')).toBe('video');
    expect(detectAssetType('clip.mkv')).toBe('video');
  });
  it('画像・拡張子なし・その他は image', () => {
    expect(detectAssetType('photo.png')).toBe('image');
    expect(detectAssetType('photo.jpeg')).toBe('image');
    expect(detectAssetType('noext')).toBe('image');
  });
});

describe('exceedsInlineAssetLimit（取り込みの一括メモリ展開しきい値・#48/A3）', () => {
  it('上限以下は false（境界＝ちょうど上限は許容）', () => {
    expect(exceedsInlineAssetLimit(0)).toBe(false);
    expect(exceedsInlineAssetLimit(1024)).toBe(false);
    expect(exceedsInlineAssetLimit(MAX_INLINE_ASSET_BYTES)).toBe(false);
  });
  it('上限超過は true', () => {
    expect(exceedsInlineAssetLimit(MAX_INLINE_ASSET_BYTES + 1)).toBe(true);
    expect(exceedsInlineAssetLimit(MAX_INLINE_ASSET_BYTES * 10)).toBe(true);
  });
});

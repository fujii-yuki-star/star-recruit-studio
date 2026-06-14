import { describe, expect, it } from 'vitest';
import { detectAssetType, fileExtension } from './assetFile';

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
  });
  it('画像・拡張子なし・その他は image', () => {
    expect(detectAssetType('photo.png')).toBe('image');
    expect(detectAssetType('photo.jpeg')).toBe('image');
    expect(detectAssetType('noext')).toBe('image');
  });
});

import { describe, expect, it } from 'vitest';
import { detectAssetType, exceedsInlineAssetLimit, fileExtension, newAssetFrom } from './assetFile';
import { MAX_INLINE_ASSET_BYTES } from '../constants';
import { ASSET_TYPE } from '../enums';

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

describe('newAssetFrom（取り込む素材1つぶんの導出・#712）', () => {
  it('名前から種別・拡張子・表示名・保存先を決める', () => {
    const { asset, fileName } = newAssetFrom('会社の外観.JPG', []);
    expect(asset.assetId).toBe('asset_001');
    expect(asset.assetType).toBe('image');
    expect(asset.displayName).toBe('会社の外観'); // 拡張子は表示名に含めない
    expect(fileName).toBe('asset_001.jpg');      // 保存先は id ＋ 小文字の拡張子
    expect(asset.filePath).toBe('assets/asset_001.jpg');
  });

  it('パスをそのまま渡せる（ネイティブの「開く」が返す絶対パス）', () => {
    // `/` と `\` の両方で末尾を取る＝Windows のパスでも「ドライブ名が表示名」にならない。
    expect(newAssetFrom(String.raw`C:\Users\me\紹介ムービー.mp4`, []).asset.displayName).toBe('紹介ムービー');
    expect(newAssetFrom('/home/me/紹介ムービー.mp4', []).asset.assetType).toBe('video');
  });

  it('名前の途中のドットは表示名に残す（拡張子だけを外す）', () => {
    // 実際のファイル名は複数ドットを含む（`会社紹介.final.mp4` など）。最初のドットで切ると名前が欠ける。
    expect(newAssetFrom('会社紹介.final.mp4', []).asset.displayName).toBe('会社紹介.final');
    expect(newAssetFrom('archive.tar.gz', []).fileName).toBe('asset_001.gz');
  });

  it('区切り文字だけの名前でも落ちない', () => {
    // `split(...).pop()` は空文字を返しうる（`?? name` では拾えない＝表示名が空になる）。
    expect(newAssetFrom('/', []).asset.displayName).toBe('新しい素材');
    expect(newAssetFrom('C:/pics/', []).asset.displayName).toBe('新しい素材');
  });

  it('採番済みの番号を渡せる（使い回さない規則は呼び出し側が持つ）', () => {
    const r = newAssetFrom('a.png', ['asset_001'], 'asset_009');
    expect(r.asset.assetId).toBe('asset_009');
    expect(r.fileName).toBe('asset_009.png');
    expect(r.asset.filePath).toBe('assets/asset_009.png');
  });

  it('採番は既存とぶつからない（11 §2.1）', () => {
    expect(newAssetFrom('a.png', ['asset_001', 'asset_002']).asset.assetId).toBe('asset_003');
  });

  it('拡張子が無いときは種別ごとの既定を使う（保存先に拡張子が要る）', () => {
    expect(newAssetFrom('写真', []).fileName).toBe('asset_001.png');
  });

  it('名前が空・空白だけでも一覧で選べる名前にする', () => {
    expect(newAssetFrom('.png', []).asset.displayName).toBe('新しい素材');
    expect(newAssetFrom('   .png', []).asset.displayName).toBe('新しい素材');
  });
});

describe('detectAssetType の音（よく使う素材・差分再監査）', () => {
  /**
   * ⚠️ **音も判定する**＝ADR-0035 は棚の中身に**ロゴ・写真・BGM**を挙げているので、
   * よく使う素材では音も置ける。判定できないと「音楽」のタブが常に0件になる。
   */
  it('音の拡張子は bgm', () => {
    for (const name of ['song.mp3', 'theme.M4A', 'bgm.wav', 'x.aac', 'y.ogg', 'z.flac']) {
      expect(detectAssetType(name)).toBe(ASSET_TYPE.bgm);
    }
  });

  /** ⚠️ **写真・動画の判定は変えない**＝動画の素材の取り込みは従来どおり。 */
  it('写真・動画はこれまでどおり', () => {
    expect(detectAssetType('a.png')).toBe(ASSET_TYPE.image);
    expect(detectAssetType('b.MP4')).toBe(ASSET_TYPE.video);
    expect(detectAssetType('noext')).toBe(ASSET_TYPE.image);
  });
});


// 取り込みのふるいは**2つある**（ボタンの `accept` とネイティブの「開く」）＝揃える（PR #912 レビュー ℹ️）。
//
// ⚠️ **タイムライン形式だけ音も受ける**＝場面形式は写真・動画のまま（BGM は BGM の導線）。
// 片方だけ広げると「ボタンからは選べるのにアプリの中では選べない」になる。
import { describe, expect, it } from 'vitest';
import { AUDIO_FILE_EXTENSIONS, IMAGE_FILE_EXTENSIONS, VIDEO_FILE_EXTENSIONS } from '../../domain/asset/assetFile';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 2つのふるいは**同じ正典**（`assetFile.ts` の拡張子）から組み立てる。 */
describe('取り込みのふるい', () => {
  it('音を受ける側は、写真・動画・音の3つを見る', () => {
    const dialog = readFileSync(join(process.cwd(), 'src/infrastructure/dialog.ts'), 'utf8');
    const picker = readFileSync(join(process.cwd(), 'src/app/hooks/useAssetPicker.ts'), 'utf8');
    // ネイティブの「開く」（よく使う素材・タイムラインの取り込み）
    expect(dialog).toMatch(/showOpenLibraryAssetsDialog[\s\S]*AUDIO_FILE_EXTENSIONS/);
    // ボタンの accept
    expect(picker).toMatch(/ACCEPT_ATTR_WITH_AUDIO[\s\S]*AUDIO_FILE_EXTENSIONS/);
    // ⚠️ **どちらも直書きしない**＝拡張子の一覧は1か所（§2-7）。
    expect(dialog).not.toMatch(/'mp3'/);
    expect(picker).not.toMatch(/'mp3'/);
  });

  it('拡張子の一覧が重なっていない（種類の判定が揺れない）', () => {
    const all = [...IMAGE_FILE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS, ...AUDIO_FILE_EXTENSIONS];
    expect(new Set(all).size).toBe(all.length);
  });
});

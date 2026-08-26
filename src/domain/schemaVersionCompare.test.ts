import { describe, expect, it } from 'vitest';
import { isNewerSchemaVersion, PROJECT_NEWER_VERSION_MESSAGE } from './schemaVersionCompare';

describe('isNewerSchemaVersion（アプリより新しい版か・#793）', () => {
  it('同じメジャーで、マイナーが大きければ新しい', () => {
    expect(isNewerSchemaVersion('1.26', '1.25')).toBe(true);
    expect(isNewerSchemaVersion('1.9', '1.8')).toBe(true);
  });

  it('同じ版・古い版は新しくない（開ける側は止めない）', () => {
    expect(isNewerSchemaVersion('1.25', '1.25')).toBe(false);
    expect(isNewerSchemaVersion('1.0', '1.25')).toBe(false);
  });

  // ⚠️ **文字列比較だと `"1.9" > "1.10"` になる**（9 のほうが新しいと誤判定）。場面形式は既に 1.25 なので
  // **いま踏む**穴。数で比べていることをここで固定する。
  it('マイナーは数で比べる（"1.9" は "1.10" より古い）', () => {
    expect(isNewerSchemaVersion('1.9', '1.10')).toBe(false);
    expect(isNewerSchemaVersion('1.10', '1.9')).toBe(true);
    expect(isNewerSchemaVersion('1.9', '1.25')).toBe(false);
  });

  // ⚠️ **メジャー違いはここで断らない**＝両形式とも**先に別の関門**が「アプリを更新してください」と
  // 正しく案内している。ここが二重に断ると、どちらの理由で止まったのか読めなくなる。
  it('メジャーが違えば false（別の関門の担当）', () => {
    expect(isNewerSchemaVersion('2.0', '1.25')).toBe(false);
    expect(isNewerSchemaVersion('0.9', '1.25')).toBe(false);
  });

  // 壊れた版は「新しい」と見なさない＝**壊れているものは壊れていると言う**（後段の検証へ渡す）。
  it('数でない版は新しいと見なさない（壊れた文書は後段の検証に任せる）', () => {
    expect(isNewerSchemaVersion('abc', '1.25')).toBe(false);
    expect(isNewerSchemaVersion('', '1.25')).toBe(false);
  });

  it('案内は「壊れている」と言わず、実行できない行動も名指ししない（§2-5）', () => {
    expect(PROJECT_NEWER_VERSION_MESSAGE).toContain('アプリを更新');
    expect(PROJECT_NEWER_VERSION_MESSAGE).not.toContain('正しくありません');
    expect(PROJECT_NEWER_VERSION_MESSAGE).not.toContain('別の');
    // §2-3＝技術用語を出さない。
    for (const word of ['バージョン', 'スキーマ', 'マイグレーション', 'JSON']) {
      expect(PROJECT_NEWER_VERSION_MESSAGE).not.toContain(word);
    }
  });
});

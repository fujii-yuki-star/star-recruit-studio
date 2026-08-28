// プロジェクトの複製（#395）。
import { describe, expect, it } from 'vitest';
import { COPY_NAME_SUFFIX, duplicateProjectDoc, duplicatedFilePaths, duplicatedProjectName } from './duplicate';
import type { Project } from './types';

const project = (over: Partial<Project> = {}): Project =>
  ({
    schemaVersion: '1.25',
    projectId: 'proj_20260101_001',
    projectName: '会社紹介',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    assets: [],
    scenes: [],
    parts: [],
    ...over,
  }) as unknown as Project;

describe('duplicatedProjectName', () => {
  it('「のコピー」を付ける', () => {
    expect(duplicatedProjectName('会社紹介')).toBe(`会社紹介${COPY_NAME_SUFFIX}`);
  });

  /** ⚠️ 「◯◯ のコピー のコピー」は読みづらい（作った順で見分けられる）。 */
  it('すでに「のコピー」なら重ねない', () => {
    expect(duplicatedProjectName(`会社紹介${COPY_NAME_SUFFIX}`)).toBe(`会社紹介${COPY_NAME_SUFFIX}`);
  });

  /** ⚠️ **接尾辞は残す**＝落ちるとどちらが複製か分からなくなる。 */
  it('長すぎるときは元の名前を削り、「のコピー」は残す', () => {
    const long = 'あ'.repeat(100);
    const r = duplicatedProjectName(long);
    expect(r.endsWith(COPY_NAME_SUFFIX)).toBe(true);
    expect(r.length).toBeLessThanOrEqual(80);
  });

  it('名前が空でも無名にしない', () => {
    expect(duplicatedProjectName('   ')).toBe(`無題のプロジェクト${COPY_NAME_SUFFIX}`);
  });
});

describe('duplicateProjectDoc', () => {
  it('身元だけ付け替える（中身はそのまま）', () => {
    const src = project({ assets: [{ assetId: 'asset_001' }] as never, scenes: [{ sceneId: 'scene_001' }] as never });
    const dup = duplicateProjectDoc(src, 'proj_20260828_002', '2026-08-28T00:00:00.000Z');
    expect(dup.projectId).toBe('proj_20260828_002');
    expect(dup.projectName).toBe(`会社紹介${COPY_NAME_SUFFIX}`);
    expect(dup.createdAt).toBe('2026-08-28T00:00:00.000Z');
    expect(dup.updatedAt).toBe('2026-08-28T00:00:00.000Z'); // 一覧の並びですぐ見つかる
    // ⚠️ **`asset_NNN` は振り直さない**＝場面が指している先が壊れない。
    expect(dup.assets).toEqual(src.assets);
    expect(dup.scenes).toEqual(src.scenes);
  });

  /** ⚠️ **元の文書を書き換えない**（呼ぶ側が元を壊さない）。 */
  it('元の文書は変えない', () => {
    const src = project();
    duplicateProjectDoc(src, 'proj_20260828_002', '2026-08-28T00:00:00.000Z');
    expect(src.projectId).toBe('proj_20260101_001');
    expect(src.projectName).toBe('会社紹介');
  });
});

describe('duplicatedFilePaths', () => {
  it('素材の本体と代表フレームを運ぶ', () => {
    const p = project({
      assets: [
        { assetId: 'asset_001', filePath: 'assets/asset_001.mp4', thumbnailPath: 'assets/asset_001_thumb.png' },
        { assetId: 'asset_002', filePath: 'assets/asset_002.png' },
      ] as never,
    });
    expect(duplicatedFilePaths(p)).toEqual([
      'assets/asset_001.mp4',
      'assets/asset_001_thumb.png',
      'assets/asset_002.png',
    ]);
  });

  /** ⚠️ **声も運ぶ**（受け入れ条件）＝運ばないと開いた先で作り直しになる。 */
  it('作成済みの読み上げ音声も運ぶ（単独・掛け合いとも）', () => {
    const p = project({
      scenes: [
        { sceneId: 's1', narration: { text: 'あ', status: 'generated', voicePath: 'voices/s1.wav' } },
        { sceneId: 's2', lines: [{ lineId: 'line_001', text: 'い', voicePath: 'voices/s2__line_001.wav' }] },
      ] as never,
    });
    expect(duplicatedFilePaths(p)).toEqual(['voices/s1.wav', 'voices/s2__line_001.wav']);
  });

  it('同じパスは1回だけ（重複を畳む）', () => {
    const p = project({
      assets: [{ filePath: 'assets/a.png' }, { filePath: 'assets/a.png' }] as never,
    });
    expect(duplicatedFilePaths(p)).toEqual(['assets/a.png']);
  });

  it('まだ作っていない声は運ばない（無いファイルを数えない）', () => {
    const p = project({ scenes: [{ sceneId: 's1', narration: { text: 'あ', status: 'none' } }] as never });
    expect(duplicatedFilePaths(p)).toEqual([]);
  });

  it('null のパスも数えない', () => {
    const p = project({ scenes: [{ sceneId: 's1', narration: { voicePath: null } }] as never });
    expect(duplicatedFilePaths(p)).toEqual([]);
  });
});

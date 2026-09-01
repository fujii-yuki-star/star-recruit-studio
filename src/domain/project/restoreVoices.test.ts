import { describe, expect, it } from 'vitest';
import type { Project, Scene } from './types';
import { clearStaleVoices } from './restoreVoices';

const scene = (id: string, text: string, status: string, lines?: { lineId: string; text: string; status: string }[]): Scene =>
  ({
    sceneId: id, sceneType: 'opening', templateId: 't', durationSec: 5,
    narration: { text, status, voicePath: `voices/${id}.wav` },
    ...(lines ? { lines: lines.map((l) => ({ ...l, voicePath: `voices/${id}_${l.lineId}.wav` })) } : {}),
  }) as unknown as Scene;

const proj = (scenes: Scene[]): Project => ({ scenes } as unknown as Project);

describe('clearStaleVoices（#967 レビュー 🟡2）', () => {
  it('文が変わっている読み上げだけ「作成前」に戻す（音は戻らないため）', () => {
    const restored = proj([scene('scene_001', '古い文', 'generated')]);
    const current = proj([scene('scene_001', '新しい文', 'generated')]);
    const { project, count } = clearStaleVoices(restored, current);
    expect(project.scenes[0].narration.status).toBe('none');
    expect(project.scenes[0].narration.voicePath).toBeNull();
    expect(count.cleared).toBe(1);
  });

  it('文が同じものは触らない（戻すたびに全部作り直させない）', () => {
    const restored = proj([scene('scene_001', '同じ文', 'generated')]);
    const current = proj([scene('scene_001', '同じ文', 'generated')]);
    const { project, count } = clearStaleVoices(restored, current);
    expect(project.scenes[0].narration.status).toBe('generated');
    expect(project.scenes[0].narration.voicePath).toBe('voices/scene_001.wav');
    expect(count.cleared).toBe(0);
  });

  it('掛け合いは行ごとに見る（変わった行だけ）', () => {
    const restored = proj([scene('scene_001', '', 'none', [
      { lineId: 'line_001', text: '古いA', status: 'generated' },
      { lineId: 'line_002', text: '同じB', status: 'generated' },
    ])]);
    const current = proj([scene('scene_001', '', 'none', [
      { lineId: 'line_001', text: '新しいA', status: 'generated' },
      { lineId: 'line_002', text: '同じB', status: 'generated' },
    ])]);
    const { project, count } = clearStaleVoices(restored, current);
    expect(project.scenes[0].lines![0].status).toBe('none');
    expect(project.scenes[0].lines![1].status).toBe('generated');
    expect(count.cleared).toBe(1);
  });

  it('いまに無い場面は触らない（音のファイルも無い）', () => {
    const restored = proj([scene('scene_009', '消えた場面', 'generated')]);
    const { project, count } = clearStaleVoices(restored, proj([]));
    expect(project.scenes[0].narration.status).toBe('generated');
    expect(count.cleared).toBe(0);
  });

  it('まだ作っていない読み上げは数えない（作り直すものが無い）', () => {
    const restored = proj([scene('scene_001', '古い文', 'none')]);
    const current = proj([scene('scene_001', '新しい文', 'generated')]);
    expect(clearStaleVoices(restored, current).count.cleared).toBe(0);
  });

  it('元の文書を書き換えない（純粋）', () => {
    const restored = proj([scene('scene_001', '古い文', 'generated')]);
    clearStaleVoices(restored, proj([scene('scene_001', '新しい文', 'generated')]));
    expect(restored.scenes[0].narration.status).toBe('generated');
  });
});

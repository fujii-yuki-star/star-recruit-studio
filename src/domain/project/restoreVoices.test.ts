import { describe, expect, it } from 'vitest';
import type { Project, Scene } from './types';
import { clearStaleVoices } from './restoreVoices';

const scene = (id: string, text: string, status: string, lines?: { lineId: string; text: string; status: string }[]): Scene =>
  ({
    sceneId: id, sceneType: 'opening', templateId: 't', durationSec: 5,
    narration: { text, status, voicePath: `voices/${id}.wav` },
    ...(lines ? { lines: lines.map((l) => ({ ...l, voicePath: `voices/${id}_${l.lineId}.wav` })) } : {}),
  }) as unknown as Scene;

const proj = (scenes: Scene[], voiceSettings: Record<string, unknown> = {}): Project =>
  ({ scenes, voiceSettings } as unknown as Project);

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

  // #967 レビュー 🟡：**文だけ比べると、同じ種類の食い違いが別の道から戻ってくる**。
  it('文が同じでも、話者が変わっていれば「作成前」に戻す', () => {
    const line = (speaker: number) => ({ lineId: 'line_001', text: '同じ文', status: 'generated', speaker });
    const restored = proj([scene('scene_001', '', 'none', [line(3) as never])]);
    const current = proj([scene('scene_001', '', 'none', [line(5) as never])]);
    const { project, count } = clearStaleVoices(restored, current);
    expect(project.scenes[0].lines![0].status).toBe('none');
    expect(count.cleared).toBe(1);
  });

  it('文が同じでも、速さ・高さ・抑揚が変わっていれば戻す', () => {
    for (const key of ['speed', 'pitch', 'intonation'] as const) {
      const mk = (v: number) => {
        const s = scene('scene_001', '文', 'generated');
        (s.narration as unknown as Record<string, number>)[key] = v;
        return proj([s]);
      };
      expect(clearStaleVoices(mk(1), mk(2)).count.cleared, key).toBe(1);
      expect(clearStaleVoices(mk(1), mk(1)).count.cleared, key).toBe(0);
    }
  });

  it('動画全体の声の設定だけが変わったときも戻す（継承をほどいて比べる）', () => {
    // 行も場面も未指定＝全体の設定を継ぐので、そこが変われば音は別物になる。
    const restored = proj([scene('scene_001', '同じ文', 'generated')], { speed: 1.0 });
    const current = proj([scene('scene_001', '同じ文', 'generated')], { speed: 1.4 });
    expect(clearStaleVoices(restored, current).count.cleared).toBe(1);
  });

  it('声の設定が無くても落ちない（落ちると、戻す側が食い違う内容をそのまま書く）', () => {
    const noSettings = { scenes: [scene('scene_001', '文', 'generated')] } as unknown as Project;
    expect(() => clearStaleVoices(noSettings, noSettings)).not.toThrow();
  });

  it('元の文書を書き換えない（純粋）', () => {
    const restored = proj([scene('scene_001', '古い文', 'generated')]);
    clearStaleVoices(restored, proj([scene('scene_001', '新しい文', 'generated')]));
    expect(restored.scenes[0].narration.status).toBe('generated');
  });
});

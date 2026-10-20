// いま入っていない声で作り済みの読み上げは、両方の形式で書き出しの前に止める（ADR-0060 段階3・PR レビュー 🔴）。
//
// ⚠️ 拡張パックを外すと声の名前が引けず、クレジットが既定のキャラへ倒れる。作り済みの音はパックの声のままなので、
//   通すと「鳴る声と名乗るキャラが違う」動画が成功として出る（ADR-0003・ADR-0026④）。形式で挙動を割らない（ADR-0026②）。
import { afterEach, describe, expect, it } from 'vitest';
import { buildPrecheckItems } from './adapters';
import { timelineExportBlockers, TIMELINE_EXPORT_BLOCK } from '../domain/timeline/export';
import { setExtraVoiceCharacters } from '../domain/voice/voiceCatalog';
import { VOICE_SPEAKER_GONE_MESSAGE, exportBlockedMessage } from './uiLabels';
import type { Scene } from '../domain/project/types';
import type { TimelineProject } from '../domain/timeline/types';

afterEach(() => setExtraVoiceCharacters([]));

const scene = (speaker: number, status = 'generated') => ({
  sceneId: 'scene_001', partId: 'part_001', order: 1, sceneType: 'photo_intro',
  templateId: 'photo_left_text_right_yuko_v1', durationSec: 8, assetRefs: {},
  character: { enabled: false, characterId: 'yuko' }, texts: {},
  narration: { text: '', status: 'none' }, warnings: [],
  lines: [{ lineId: 'line_001', text: 'こんにちは', speaker, status }],
}) as unknown as Scene;

const doc = (speaker: number, status = 'generated'): TimelineProject =>
  ({
    schemaVersion: '1.20', format: 'timeline', projectId: 'proj_20261014_0001', projectName: 't', createdAt: '', updatedAt: '',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 180 },
    voiceSettings: {}, assets: [],
    tracks: [{ id: 'track_001', kind: 'audio', name: '音1' }],
    clips: [{ id: 'clip_001', kind: 'voice', trackId: 'track_001', startSec: 0, durationSec: 3, voice: { text: 'こんにちは', speaker, status } }],
  }) as unknown as TimelineProject;

const sceneGone = (s: Scene) => buildPrecheckItems([s], [], []).find((i) => i.id === 'goneVoice');
const timelineGone = (d: TimelineProject) => timelineExportBlockers(d).find((b) => b.code === TIMELINE_EXPORT_BLOCK.voiceGone);

describe('いま入っていない声の門', () => {
  it('パックの声が入っている間は止めない', () => {
    setExtraVoiceCharacters([{ character: 'あおい', styles: [{ speaker: 9001, label: 'ノーマル' }] }]);
    expect(sceneGone(scene(9001))).toBeUndefined();
    expect(timelineGone(doc(9001))).toBeUndefined();
  });

  it('外したあと、作り済みなら両形式とも止める（同じ文）', () => {
    const item = sceneGone(scene(9001));
    expect(item?.blocksExport).toBe(true);
    expect(item?.detail).toBe(`${VOICE_SPEAKER_GONE_MESSAGE}。`);
    expect(timelineGone(doc(9001))?.clipIds).toEqual(['clip_001']);
    expect(exportBlockedMessage[TIMELINE_EXPORT_BLOCK.voiceGone]).toBe(VOICE_SPEAKER_GONE_MESSAGE);
  });

  it('まだ作っていない・同梱の声なら止めない（作れば既定の声で作られ、クレジットも合う＝V19）', () => {
    expect(sceneGone(scene(9001, 'none'))).toBeUndefined();
    expect(timelineGone(doc(9001, 'none'))).toBeUndefined();
    expect(sceneGone(scene(3))).toBeUndefined();
    expect(timelineGone(doc(3))).toBeUndefined();
  });
});

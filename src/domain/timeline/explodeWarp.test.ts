// 反転・動きの支点・縦横別々の大きさの動きを持つ部品はバラせない（ADR-0059・PR #1414 レビュー 🔴）。
// バラすと動きはまとまりへ移るが、まとまりの変形は相似変換＝縦横の倍率は捨てられ、支点は外接矩形の中心に化ける。
import { describe, expect, it } from 'vitest';
import { EDIT_BLOCKED } from './edit';
import { explodeTemplateClip } from './explode';
import { PROJECT_FORMAT, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import { TIMELINE_SCHEMA_VERSION } from './types';
import type { TimelineClip, TimelineProject } from './types';
import type { Template } from '../template/types';

const template = {
  schemaVersion: '1.0', templateId: 'tmpl_a', name: 'A', category: 'message', aspectRatio: '16:9',
  canvas: { width: 1920, height: 1080 },
  layers: [
    { id: 'title', type: 'text', textKey: 'title', x: 0, y: 0, w: 800, h: 100 },
    { id: 'sub', type: 'text', textKey: 'main', x: 0, y: 200, w: 800, h: 100 },
  ],
} as unknown as Template;
const tpl = (over: Partial<TimelineClip> = {}): TimelineClip =>
  ({ id: 'clip_001', kind: TIMELINE_CLIP_KIND.template, templateId: 'tmpl_a', trackId: 'track_001', startSec: 0, durationSec: 10, x: 0, y: 0, w: 1920, h: 1080, texts: { title: 'あ', main: 'い' }, ...over }) as TimelineClip;
function doc(clips: TimelineClip[], animations: TimelineProject['animations'] = []): TimelineProject {
  return {
    schemaVersion: TIMELINE_SCHEMA_VERSION, format: PROJECT_FORMAT.timeline, projectId: 'proj_20261009_001', projectName: 't',
    createdAt: '2026-10-09T00:00:00.000Z', updatedAt: '2026-10-09T00:00:00.000Z',
    videoSettings: { aspectRatio: '16:9', fps: 30, targetDurationSec: 60, maxDurationSec: 600 },
    voiceSettings: { defaultVoiceId: 'voicevox_zundamon' }, assets: [],
    tracks: [{ id: 'track_001', kind: TRACK_KIND.visual }], clips, animations,
  } as TimelineProject;
}
const blocked = { ok: false, reason: EDIT_BLOCKED.explodeWarp };

describe('バラす：反転・動きの支点・縦横別々の大きさ（ADR-0059）', () => {
  it('反転していればバラさない（バラした部品へ反転が写らない）', () => {
    expect(explodeTemplateClip(doc([tpl({ flipX: true })]), 'clip_001', template)).toEqual(blocked);
    expect(explodeTemplateClip(doc([tpl({ flipY: true })]), 'clip_001', template)).toEqual(blocked);
  });
  it('動きの支点を外していればバラさない（まとまりの支点は外接矩形の中心に化ける）', () => {
    expect(explodeTemplateClip(doc([tpl({ pivot: { x: 0.5, y: 1 } })]), 'clip_001', template)).toEqual(blocked);
  });
  it('縦横別々の大きさの動きがあればバラさない（まとまりでは捨てられる）', () => {
    const anim = [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, scaleX: -1 }] }];
    expect(explodeTemplateClip(doc([tpl()], anim), 'clip_001', template)).toEqual(blocked);
    const animY = [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, scaleY: 0.5 }] }];
    expect(explodeTemplateClip(doc([tpl()], animY), 'clip_001', template)).toEqual(blocked);
  });
  it('縦横が 1 のままなら、ふつうにバラせる', () => {
    const anim = [{ id: 'anim_001', targetId: 'clip_001', keyframes: [{ timeSec: 0, scaleX: 1, scaleY: 1, x: 10 }] }];
    expect(explodeTemplateClip(doc([tpl()], anim), 'clip_001', template).ok).toBe(true);
  });
});

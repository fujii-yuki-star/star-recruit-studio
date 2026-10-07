// 喋っている間の動き（ADR-0056・#1367）。純粋関数（§7 テスト対象）。
//
// ⚠️ **描画の核は1つ**（ADR-0001）＝足す量はここだけで決め、`layoutTimelineAt`（プレビュー＝書き出し）が使う。
// ⚠️ **キーフレームの上に足す**＝縦のずれは足し、大きさは掛ける（手で打った動きを止めない）。
// ⚠️ **口パクではない**（`CLAUDE.md §10`）＝絵は1枚のまま、位置・大きさだけ動かす。
import { TALK_MOTION_KIND, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import type { TimelineClip, TimelineProject } from './types';

/** はねる：上がりきるまで（秒）・戻りきるまで（秒・声の頭から）・高さ（px）。作例（#1135）の手打ちと同じ。 */
export const TALK_BOUNCE_UP_SEC = 0.12;
export const TALK_BOUNCE_END_SEC = 0.3;
export const TALK_BOUNCE_PX = 16;
/** ゆらゆら：上下の幅（px）。ふくらむ：大きさの幅（倍）。揺れの速さ（回/秒）。入り・抜けにかける秒。 */
export const TALK_BOB_PX = 10;
export const TALK_PULSE_SCALE = 0.03;
export const TALK_WAVE_HZ = 2.5;
export const TALK_EASE_SEC = 0.1;
/** 強さの上限（schema の maximum と同じ）。 */
export const TALK_MOTION_STRENGTH_MAX = 5;

/** 足す量（縦のずれ px・大きさの倍）。動かないときは `{ dy: 0, scale: 1 }`。 */
export interface TalkMotionOffset {
  dy: number;
  scale: number;
}

const NONE: TalkMotionOffset = { dy: 0, scale: 1 };

/**
 * その部品を動かす**声の部品**（結んだ音の列の、隠していない声）。結んでいない・列が無い・音の列でない・
 * 隠した列なら空。⚠️ **動くのはこの声が鳴っている間だけ**＝描く側（`talkMotionAt`）と書き出しの区間の割り方
 * （`planTimelineExportSegments`）が**同じ1つ**を見る（片方だけ条件が増えると、動く所を止めた絵で流してしまう）。
 */
export function talkMotionVoices(doc: TimelineProject, clip: TimelineClip): TimelineClip[] {
  const tm = clip.talkMotion;
  if (!tm) return [];
  const track = doc.tracks.find((t) => t.id === tm.trackId);
  if (!track || track.kind !== TRACK_KIND.audio || track.hidden) return [];
  return doc.clips.filter((c) => c.kind === TIMELINE_CLIP_KIND.voice && c.trackId === tm.trackId && !c.hidden);
}

/**
 * その時刻に、その部品へ足す「喋っている間の動き」。
 *
 * - 結んだ列が無い・音の列でない・隠してある＝動かない（黙って別の列を探さない）
 * - その列の**声の部品**のうち、時刻が `[頭, 終わり)` に入っているもの（隠した部品は数えない）。
 *   ⚠️ 声を作ったかどうかは見ない＝作る前でもプレビューで動く。
 * - 同じ時刻に2つ生きていれば**先に始まったほう**（同時なら id の順）で数える＝重ねて2倍にしない。
 */
export function talkMotionAt(doc: TimelineProject, clip: TimelineClip, timeSec: number): TalkMotionOffset {
  const tm = clip.talkMotion;
  if (!tm) return NONE;
  const voice = talkMotionVoices(doc, clip)
    .filter((c) => timeSec >= c.startSec && timeSec < c.startSec + c.durationSec)
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))[0];
  if (!voice) return NONE;
  const s = tm.strength ?? 1;
  const local = timeSec - voice.startSec;
  switch (tm.kind) {
    case TALK_MOTION_KIND.bounce: {
      if (local < TALK_BOUNCE_UP_SEC) {
        const x = local / TALK_BOUNCE_UP_SEC;
        return { dy: -TALK_BOUNCE_PX * s * (1 - (1 - x) * (1 - x)), scale: 1 }; // ゆっくり終わる
      }
      if (local < TALK_BOUNCE_END_SEC) {
        const x = (local - TALK_BOUNCE_UP_SEC) / (TALK_BOUNCE_END_SEC - TALK_BOUNCE_UP_SEC);
        return { dy: -TALK_BOUNCE_PX * s * (1 - x * x), scale: 1 }; // ゆっくり始まる
      }
      return NONE;
    }
    case TALK_MOTION_KIND.bob:
    case TALK_MOTION_KIND.pulse: {
      // 入り・抜けはなめらかに（声の頭と終わりで絵が跳ばない）。
      const left = voice.startSec + voice.durationSec - timeSec;
      const env = Math.max(0, Math.min(1, local / TALK_EASE_SEC, left / TALK_EASE_SEC));
      const wave = Math.abs(Math.sin(2 * Math.PI * TALK_WAVE_HZ * local)) * env;
      return tm.kind === TALK_MOTION_KIND.bob
        ? { dy: -TALK_BOB_PX * s * wave, scale: 1 }
        : { dy: 0, scale: 1 + TALK_PULSE_SCALE * s * wave };
    }
    default: {
      // 値が増えたらここがコンパイルエラーになる＝黙って動かさない、にしない（§2-7）。
      const exhaustive: never = tm.kind;
      return exhaustive;
    }
  }
}

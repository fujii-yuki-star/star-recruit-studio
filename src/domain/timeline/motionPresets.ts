// タイムライン形式の動きのひな形（#1349・#1335 提案D）。純粋関数（副作用なし・§7 テスト対象）。
//
// ⚠️ **描画に新しい機能を足さない**＝ひな形は**既存の `Keyframe` の列へ展開する**だけ（場面形式の
//   `animationPresets` と同じ方式）。処理の重さは増えず、当てたあとは点（ADR-0054 段階2）や「動き」の欄で直せる。
// ⚠️ **値は「本来の見た目からのずれ」**（keyframeEdit の冒頭）＝x/y は足す px・scale は倍率・rotation は足す度・opacity は濃さ。
//
// 3つの置き場所：
// - **登場**＝帯の始まりから（場面形式の4種と同じ動き）
// - **退場**＝帯の終わりで終える（登場の逆再生）
// - **強調**＝再生位置から（ズーム・震える・はねる）＝実況でよく使う短い動き
import { EASING } from '../enums';
import type { EasingSpec } from '../enums';
import {
  PRESET_DEFAULT_SEC,
  PRESET_MAX_SEC,
  PRESET_MIN_SEC,
  presetKeyframes,
  type PresetKind,
  type SlideDirection,
} from '../project/animationPresets';
import { interpolateKeyframes, KEYFRAME_PROPS } from '../project/keyframes';
import type { Keyframe } from '../project/types';
import { setKeyframe } from './keyframeEdit';
import type { EditResult } from './edit';
import type { TimelineProject } from './types';

export { PRESET_DEFAULT_SEC as MOTION_PRESET_DEFAULT_SEC, PRESET_MIN_SEC as MOTION_PRESET_MIN_SEC, PRESET_MAX_SEC as MOTION_PRESET_MAX_SEC };

/** 強調の動き（再生位置から）。 */
export const EMPHASIS_KINDS = ['zoom', 'shake', 'bounce'] as const;
export type EmphasisKind = (typeof EMPHASIS_KINDS)[number];

/** 強調の大きさ（既定量・キャンバスの px／倍率）。はっきり分かる量にする。 */
export const EMPHASIS_ZOOM_SCALE = 1.2;
export const EMPHASIS_SHAKE_PX = 12;
export const EMPHASIS_BOUNCE_PX = 40;

export type MotionPreset =
  | { place: 'in'; kind: PresetKind; direction?: SlideDirection; durationSec: number }
  | { place: 'out'; kind: PresetKind; direction?: SlideDirection; durationSec: number }
  | { place: 'emphasis'; kind: EmphasisKind; durationSec: number };

/** 長さを除いたひな形（選択肢の一覧が持つ形）。⚠️ 和の型は `Omit` で潰れるので、1つずつ外す。 */
export type MotionPresetShape = MotionPreset extends infer P ? (P extends MotionPreset ? Omit<P, 'durationSec'> : never) : never;

const clampDur = (s: number): number => Math.max(PRESET_MIN_SEC, Math.min(PRESET_MAX_SEC, s));

/** 強調の動きの形（0 秒から `d` 秒までの相対の時刻）。始まりと終わりは「ずれ無し」＝前後の見た目へなめらかに戻る。 */
function emphasisKeyframes(kind: EmphasisKind, d: number): Keyframe[] {
  const at = (r: number): number => Math.round(d * r * 1e6) / 1e6;
  switch (kind) {
    case 'zoom':
      return [
        { timeSec: 0, scale: 1 },
        { timeSec: at(0.4), scale: EMPHASIS_ZOOM_SCALE, easing: EASING.easeOut },
        { timeSec: d, scale: 1, easing: EASING.easeInOut },
      ];
    case 'shake': {
      const s = EMPHASIS_SHAKE_PX;
      const xs = [0, -s, s, -s * 0.66, s * 0.66, -s * 0.33, 0];
      return xs.map((x, i) => ({ timeSec: at(i / (xs.length - 1)), x }));
    }
    case 'bounce': {
      const h = EMPHASIS_BOUNCE_PX;
      return [
        { timeSec: 0, y: 0 },
        { timeSec: at(0.3), y: -h, easing: EASING.easeOut },
        { timeSec: at(0.6), y: 0, easing: EASING.easeIn },
        { timeSec: at(0.8), y: -h * 0.35, easing: EASING.easeOut },
        { timeSec: d, y: 0, easing: EASING.easeIn },
      ];
    }
  }
}

/**
 * 登場の形を逆にたどって退場の形にする（終わりで「ずれ」の側へ抜ける）。動き方は区間ごとに付け替える。
 * ⚠️ **左右対称の動き方だけを前提にしている**（PR #1353 レビュー ℹ️）＝時間を逆にすると「ゆっくり始まる」と
 *   「ゆっくり終わる」が入れ替わるが、ここでは入れ替えない。いまのひな形はどれも ease-in-out（対称）なので結果は正しい。
 */
function reverseKeyframes(kfs: readonly Keyframe[], d: number): Keyframe[] {
  const rev = [...kfs].reverse();
  return rev.map((k, i) => {
    const { easing: _e, ...rest } = k;
    // 区間 [前, 当] の動き方＝当の easing。逆にすると、元の区間 [k_{n-i-1}, k_{n-i}] の動き方がこの区間になる。
    const easing: EasingSpec | undefined = i === 0 ? undefined : rev[i - 1].easing;
    return { ...rest, timeSec: Math.round((d - k.timeSec) * 1e6) / 1e6, ...(easing != null ? { easing } : {}) };
  });
}

/**
 * 登場・退場が使える長さの上限＝**帯の半分まで**（PR #1353 レビュー 🟡）＝短い帯に登場と退場を両方当てたとき、
 * 黙って食い合って登場が縮む、を作らない。画面は押す前にこの長さを見せる（`motionPresetEffectiveSec`）。
 */
function sideCapSec(clipDurationSec: number): number {
  return Math.min(PRESET_MAX_SEC, clipDurationSec / 2);
}

/** 実際に使われる長さ（範囲・帯の長さで収めたあと）。画面が「この帯では◯秒になります」を出すのに使う。 */
export function motionPresetEffectiveSec(preset: MotionPreset, clipDurationSec: number): number {
  const d = clampDur(preset.durationSec);
  return preset.place === 'emphasis' ? Math.min(d, clipDurationSec) : Math.min(d, sideCapSec(clipDurationSec));
}

/**
 * ひな形を、**帯の先頭からの秒**のキーフレーム列にする。
 *
 * - 長さは 0.1〜5 秒、さらに**帯の長さに収める**（はみ出した点は描かれない時刻＝置いても効かない）。
 * - 強調は `atSec`（帯の先頭からの再生位置）から。終わりが帯の外へ出るなら、帯の終わりで終わるよう前へずらす。
 */
export function motionPresetKeyframes(
  preset: MotionPreset,
  clip: { durationSec: number },
  opts: { atSec?: number; endOpacity?: number; base?: readonly Keyframe[] } = {},
): Keyframe[] {
  const d = motionPresetEffectiveSec(preset, clip.durationSec);
  if (!(d > 0)) return [];
  if (preset.place === 'emphasis') {
    const start = Math.max(0, Math.min(opts.atSec ?? 0, clip.durationSec - d));
    // ⚠️ **いまの動きの上に足す**（PR #1353 レビュー 🟡）＝始まりと終わりを「ずれ無し」の絶対値で置くと、同じ項目に
    //   動きがある区間（ゆっくり拡大など）で、その動きが途中で引き戻されて跳ぶ。各点の値＝その時刻のいまの値に
    //   強調の分を足す（倍率は掛ける）。⚠️ **動き方は付けない**＝点ごとに持つので、既存の点と重なると
    //   別の項目の区間の動き方まで書き換えてしまう。
    const base = opts.base ?? [];
    return emphasisKeyframes(preset.kind, d).map((k) => {
      const t = Math.round((start + k.timeSec) * 1e6) / 1e6;
      const now = interpolateKeyframes(base, t);
      const out: Keyframe = { timeSec: t };
      if (k.scale != null) out.scale = Math.round((now.scale ?? 1) * k.scale * 1e6) / 1e6;
      if (k.x != null) out.x = (now.x ?? 0) + k.x;
      if (k.y != null) out.y = (now.y ?? 0) + k.y;
      return out;
    });
  }
  const base = presetKeyframes(preset.kind, {
    durationSec: d,
    easing: EASING.easeInOut,
    direction: preset.direction,
    endOpacity: opts.endOpacity ?? 1,
  }).map((k) => ({ ...k, timeSec: Math.min(k.timeSec, d) }));
  if (preset.place === 'in') return base;
  const offset = clip.durationSec - d;
  return reverseKeyframes(base, d).map((k) => ({ ...k, timeSec: Math.round((offset + k.timeSec) * 1e6) / 1e6 }));
}

/**
 * ひな形を部品（クリップ）に当てる＝**1回の編集**（取り消し1回で戻る）。
 *
 * ⚠️ **置き換えずに重ねる**＝その時刻のキーフレームは、ひな形が持つ項目だけ差し替える（`setKeyframe` と同じ規則）。
 *   既に付けた別の項目の動き（たとえば位置の動きにズームを足す）は消さない。
 * ⚠️ 固定した列・見つからない部品は断る（`setKeyframe` の関門をそのまま通す）。
 */
export function applyMotionPreset(
  doc: TimelineProject,
  clipId: string,
  preset: MotionPreset,
  opts: { atSec?: number; endOpacity?: number } = {},
): EditResult {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return setKeyframe(doc, clipId, 0, {}); // 断る理由は setKeyframe に1つ（notFound）
  const existing = (doc.animations ?? []).find((a) => a.targetId === clipId)?.keyframes ?? [];
  const kfs = motionPresetKeyframes(preset, clip, { ...opts, base: existing });
  let cur = doc;
  // ⚠️ **登場・退場は当て直すと置き換わる**（PR #1353 レビュー 🟡・業界の型＝登場・退場は枠が1つ）＝その側
  //   （始まりから／終わりまで、帯の半分まで）にある点を**項目を問わず**外してから置く。外さないと、長さや種類を
  //   変えて当て直したときに古い点が残り、「当て直したのに変わらない／前の動きが混ざる」（ぽんっと→ふわっとで倍率が残る）。
  //   ⚠️ その側の外（帯の真ん中）の点は残す＝登場・退場の枠の外の動きには触らない。
  if (preset.place !== 'emphasis') {
    const cap = sideCapSec(clip.durationSec);
    const inSide = (t: number): boolean => (preset.place === 'in' ? t <= cap : t >= clip.durationSec - cap);
    for (const k of existing) {
      if (!inSide(k.timeSec)) continue;
      const clear = Object.fromEntries(KEYFRAME_PROPS.filter((prop) => k[prop] != null).map((prop) => [prop, null]));
      if (Object.keys(clear).length === 0) continue;
      const r = setKeyframe(cur, clipId, k.timeSec, clear);
      if (!r.ok) return r;
      cur = r.doc;
    }
  }
  for (const k of kfs) {
    const { timeSec, easing, ...props } = k;
    const r = setKeyframe(cur, clipId, timeSec, { ...props, ...(easing != null ? { easing } : {}) });
    if (!r.ok) return r;
    cur = r.doc;
  }
  return { ok: true, doc: cur };
}

// タイムライン形式（ADR-0032）の意味検証（11 §8 V22–V26）。純粋関数（副作用なし）。
// スキーマ適合（型/必須/enum/範囲＝V1,V2）は ajv 済み前提で、ここは schema で表せない
// 相互参照・横断条件だけを見て Warning[] を返す。
// エラーコード語彙は 15_ERROR_STATE_MODEL.md §6。文言は §2-5「次の行動」を示す。
import { ASSET_TYPE, TIMELINE_CLIP_KIND, TRACK_KIND } from '../enums';
import type { TimelineClipKind, TrackKind } from '../enums';
import type { Warning } from '../project/types';
import type { ClipAnimation, TimelineClip, TimelineProject, Track } from './types';

function warn(code: string, message: string, field: string, severity: Warning['severity'] = 'warning'): Warning {
  return { code, message, field, severity, autoFixed: false };
}

/**
 * クリップ種別を置けるトラック種別（11 §8 V23）。
 * 音は音の列、それ以外（映像・文字・図形・字幕・テンプレ）は映像の列。
 */
const TRACK_KIND_FOR_CLIP = {
  [TIMELINE_CLIP_KIND.slot]: TRACK_KIND.visual,
  [TIMELINE_CLIP_KIND.text]: TRACK_KIND.visual,
  [TIMELINE_CLIP_KIND.shape]: TRACK_KIND.visual,
  [TIMELINE_CLIP_KIND.subtitle]: TRACK_KIND.visual,
  [TIMELINE_CLIP_KIND.template]: TRACK_KIND.visual,
  [TIMELINE_CLIP_KIND.audio]: TRACK_KIND.audio,
  [TIMELINE_CLIP_KIND.voice]: TRACK_KIND.audio,
} as const satisfies Record<TimelineClipKind, TrackKind>;

/** 読み上げクリップか（音の出どころが「中身」＝素材でも同梱BGMでもない・#628）。 */
export function isVoiceClip(clip: TimelineClip): boolean {
  return clip.kind === TIMELINE_CLIP_KIND.voice;
}

/** クリップが占める時間の区間 `[startSec, endSec)`。 */
export function clipEndSec(clip: TimelineClip): number {
  return clip.startSec + clip.durationSec;
}

/**
 * 同一トラック内で時間が重なるクリップの組を返す（11 §8 V24）。
 * 端が接するだけ（前の終わり＝次の始まり）は重なりではない。
 * これが本形式の要＝重なりが無いので**重ね順は tracks の並び順だけで一意に決まる**
 * （クリップごとの zIndex を持たない理由）。
 */
export function overlappingClipPairs(clips: TimelineClip[]): Array<[TimelineClip, TimelineClip]> {
  const byTrack = new Map<string, TimelineClip[]>();
  for (const c of clips) {
    const list = byTrack.get(c.trackId);
    if (list) list.push(c);
    else byTrack.set(c.trackId, [c]);
  }
  const pairs: Array<[TimelineClip, TimelineClip]> = [];
  for (const list of byTrack.values()) {
    const sorted = [...list].sort((a, b) => a.startSec - b.startSec);
    for (let i = 1; i < sorted.length; i += 1) {
      // 直前だけでなく、それ以前の長いクリップに覆われている場合もあるので端の最大値を持ち回る。
      for (let j = i - 1; j >= 0; j -= 1) {
        if (clipEndSec(sorted[j]) > sorted[i].startSec) pairs.push([sorted[j], sorted[i]]);
      }
    }
  }
  return pairs;
}

/**
 * タイムライン文書を検証して警告を返す（警告＝行動は止めない）。
 * V22 trackId 実在／V23 クリップ種別とトラック種別の一致／V24 同一トラック内の時間の重なり／
 * V25 素材の実在・音の出どころの排他／V26 グループ members・アニメ targetId の実在。
 */
export function validateTimelineDoc(doc: TimelineProject): Warning[] {
  const warnings: Warning[] = [];
  const trackById = new Map<string, Track>(doc.tracks.map((t) => [t.id, t]));
  const assetIds = new Set(doc.assets.map((a) => a.assetId));
  // 立ち絵（V27）は**種別で絞る**。実在するだけでは足りず yuko 素材でないと立ち絵にならない
  // （場面形式 V5 と同じ観点＝写真や動画の id を指しても描けない）。
  const yukoAssetIds = new Set(doc.assets.filter((a) => a.assetType === ASSET_TYPE.yuko).map((a) => a.assetId));

  for (const clip of doc.clips) {
    const field = `clips.${clip.id}`;
    const track = trackById.get(clip.trackId);

    // V22: どのトラックに置くか決まっていない＝描画・書き出しから外れる。黙って消さない（§2-5）。
    if (!track) {
      warnings.push(warn('TIMELINE_TRACK_NOT_FOUND', 'どの列に置くか決まっていない部品があります。列を選び直してください', field));
    } else if (track.kind !== TRACK_KIND_FOR_CLIP[clip.kind]) {
      // V23: 音の部品を映像の列に置く（逆も）と鳴らない/映らないので知らせる。
      warnings.push(warn('TIMELINE_CLIP_TRACK_KIND', '音の部品は音の列に、絵や文字の部品は映像の列に置いてください', field));
    }

    // V25: 素材の実在（null/未指定＝空は可）と、音の出どころの排他。
    if (clip.assetId != null && !assetIds.has(clip.assetId)) {
      warnings.push(warn('ASSET_NOT_FOUND', '使う写真・動画が見つかりません。選び直してください', field));
    }
    // 読み上げは中身（読み上げ文と話者）が音の出どころなので、素材や同梱BGMを重ねて指定させない。
    const audioSources = [clip.assetId != null, clip.bundledBgmId != null, isVoiceClip(clip)].filter(Boolean).length;
    if (audioSources > 1) {
      warnings.push(warn('TIMELINE_AUDIO_SOURCE_CONFLICT', '音の出どころが2つ指定されています。どちらか一方にしてください', field));
    }

    // V27: 立ち絵の表情（テンプレクリップ）が実在する **yuko 素材** か（場面形式の V5 と同じ観点）。
    const poseAssetId = clip.character?.poseAssetId;
    if (poseAssetId != null && !yukoAssetIds.has(poseAssetId)) {
      warnings.push(warn('ASSET_NOT_FOUND', '使う写真・動画が見つかりません。選び直してください', `${field}.character`));
    }

    // V28: 読み上げクリップの中身。schema が voice の有無と必須（text/status）を担保するので、
    // ここは「空白だけの読み上げ文」＝声を作っても無音になるものだけを拾う（FREE_TEXT_EMPTY と同じ流儀・info）。
    if (isVoiceClip(clip) && clip.voice != null && clip.voice.text.trim().length === 0) {
      warnings.push(warn('TIMELINE_VOICE_TEXT_EMPTY', '読み上げる文が入っていません。文を入力してください', field, 'info'));
    }
    // voice を持てるのは読み上げクリップだけ（持たせても鳴らないので黙って無視しない・§2-5）。
    if (!isVoiceClip(clip) && clip.voice != null) {
      warnings.push(warn('TIMELINE_VOICE_ON_NON_VOICE', '読み上げの中身は読み上げの部品にだけ置けます。読み上げの部品に置き直してください', field));
    }
  }

  // V24: 同一トラック内の時間の重なり。重ねたいならトラックを足す。
  // 3本以上が重なると同じクリップが複数の組に現れるので、後ろ側のクリップごとに1件へまとめる
  // （同じ場所に同じ案内を何度も出さない）。
  const overlapped = new Set(overlappingClipPairs(doc.clips).map(([, later]) => later.id));
  for (const id of overlapped) {
    warnings.push(warn('TIMELINE_CLIP_OVERLAP', '同じ列で時間が重なっています。ずらすか、列を増やして重ねてください', `clips.${id}`));
  }

  return warnings;
}

/**
 * グループ members・アニメ targetId の参照切れを返す（11 §8 V26）。
 * 描画側は無視して堅牢に振る舞う（V20 と同じ扱い）ので Warning ではなく id の一覧を返し、
 * 呼び出し側（読込検証・掃除）が使う。
 */
export function danglingTimelineRefs(doc: TimelineProject): { groupMembers: string[]; animationTargets: string[] } {
  const clipIds = new Set(doc.clips.map((c) => c.id));
  const groupIds = new Set((doc.groups ?? []).map((g) => g.id));
  const exists = (id: string): boolean => clipIds.has(id) || groupIds.has(id);

  const groupMembers = (doc.groups ?? []).flatMap((g) => g.members.filter((m) => !exists(m)));
  const animationTargets = (doc.animations ?? [])
    .filter((a: ClipAnimation) => !exists(a.targetId))
    .map((a) => a.targetId);
  return { groupMembers, animationTargets };
}

// タイムライン形式（ADR-0032）の意味検証（11 §8 V22–V32）。純粋関数（副作用なし）。
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

/**
 * そのクリップを置ける列の種別（11 §8 V23）。**検証と編集が同じ表を見る**ための入口（§6）＝
 * 「音は音の列」の対応を2か所に書かない（片方だけ変えると、検証は通るのに置けない〔逆も〕が起きる）。
 */
export function trackKindForClip(kind: TimelineClipKind): TrackKind {
  return TRACK_KIND_FOR_CLIP[kind];
}

/**
 * 「接している」とみなす幅（秒）。**文書が保持している精度そのもの**＝端の編集は 1マイクロ秒より
 * 細かい桁を落とす（`applyClipEdge` の `SEC_PRECISION`）ので、それより細かいずれは**書き分けられない**。
 * 30fps の 1/33000 フレーム＝どの絵にも音にも影響しない。
 */
const TOUCHING_EPSILON_SEC = 1e-6;

/**
 * 2つの時間の区間が重なるか（11 §8 V24）。区間は半開 `[start, end)`＝**端が接するのは重ならない**。
 * 検証（重なりの警告）と編集（置けるかの判定）が**同じ述語**を使う（境界の扱いを2か所に書かない）。
 *
 * ⚠️ **1マイクロ秒までは「接している」とみなす**（#686 段階4）。指の位置から出た時刻は15桁あるのに
 * 長さは 1µs へ丸めて保存するので、**ぴったり隣へ寄せたはずの端が数十兆分の1秒だけはみ出す**。
 * 許容が無いと、吸着で隣にくっつけるトリムの **44.5%** が「同じ列で時間が重なります」で断られた
 * （px を総当たりして実測）。⚠️ 見た目も出力も同じなのに操作だけ断られる、を作らない（ADR-0026④）。
 */
export function spansOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd - TOUCHING_EPSILON_SEC && bStart < aEnd - TOUCHING_EPSILON_SEC;
}

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
        if (spansOverlap(sorted[j].startSec, clipEndSec(sorted[j]), sorted[i].startSec, clipEndSec(sorted[i]))) {
          pairs.push([sorted[j], sorted[i]]);
        }
      }
    }
  }
  return pairs;
}

/**
 * **重なっている id**（V32・#811）。重なった2つ目以降を `<入れ物>.<id>` の形で返す（空なら重複なし）。
 *
 * 見るのは**入れ物ごと**（`clips`/`tracks`/`groups`/`animations` のそれぞれ）＝入れ物をまたいだ衝突
 *（クリップ id ＝グループ id。読む側は `targetId` を両方から引く）は**接頭辞が違うので採番から起きない**。
 *
 * ⚠️ **保存の門と共有する**（`bakeToTimeline`）＝この検証は「知らせる」だけなので、**壊れた文書を
 * ディスクへ書かない**のは門の側の仕事。schema では表せない（配列をまたいだ id の一意は JSON Schema
 * の語彙に無い）ので、適合チェックだけでは素通りする。
 */
export function duplicateIdsIn(doc: TimelineProject): string[] {
  const found: string[] = [];
  for (const [ids, field] of [
    [doc.clips.map((c) => c.id), 'clips'],
    [doc.tracks.map((t) => t.id), 'tracks'],
    [(doc.groups ?? []).map((g) => g.id), 'groups'],
    [(doc.animations ?? []).map((a) => a.id), 'animations'],
  ] as const) {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) found.push(`${field}.${id}`);
      seen.add(id);
    }
  }
  return found;
}

/**
 * タイムライン文書を検証して警告を返す（警告＝行動は止めない）。
 * V22 trackId 実在／V23 クリップ種別とトラック種別の一致／V24 同一トラック内の時間の重なり／
 * V25 素材の実在・音の出どころの排他／V26 グループ members・アニメ targetId の実在／
 * V29 字幕の連動先の実在（ADR-0032 決定24）／V30 切り抜きで丸ごと隠れていないか（#634）。
 * V31 **同じ対象に動きは1本まで**（#717・読む側が1本しか見ない）／
 * V32 **id は文書の中で一意**（#811・読む側が id で引き当てるので、重なると別のものに効く）。
 */
export function validateTimelineDoc(doc: TimelineProject): Warning[] {
  const warnings: Warning[] = [];
  const trackById = new Map<string, Track>(doc.tracks.map((t) => [t.id, t]));
  const assetIds = new Set(doc.assets.map((a) => a.assetId));
  // 立ち絵（V27）は**種別で絞る**。実在するだけでは足りず yuko 素材でないと立ち絵にならない
  // （場面形式 V5 と同じ観点＝写真や動画の id を指しても描けない）。
  const yukoAssetIds = new Set(doc.assets.filter((a) => a.assetType === ASSET_TYPE.yuko).map((a) => a.assetId));

  const clipById = new Map(doc.clips.map((c) => [c.id, c]));
  for (const clip of doc.clips) {
    const field = `clips.${clip.id}`;
    const track = trackById.get(clip.trackId);

    // V22: どのトラックに置くか決まっていない＝描画・書き出しから外れる。黙って消さない（§2-5）。
    if (!track) {
      warnings.push(warn('TIMELINE_TRACK_NOT_FOUND', 'どの列に置くか決まっていない部品があります。列を選び直してください', field));
    } else if (track.kind !== trackKindForClip(clip.kind)) {
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

    // V30: 切り抜きで丸ごと隠れていないか（同じ軸の合計が 1 以上＝その部品は動画に出ない）。
    // 編集からは作れないが、手編集・将来の取り込みで来うる＝黙って消えたことに気づけないので知らせる。
    const crop = clip.crop;
    if (crop != null) {
      const v = (crop.top ?? 0) + (crop.bottom ?? 0);
      const h = (crop.left ?? 0) + (crop.right ?? 0);
      if (v >= 1 || h >= 1) {
        warnings.push(warn('TIMELINE_CROP_HIDES_ALL', '切り抜きで全部隠れている部品があります。切り抜きを小さくしてください', field));
      }
    }

    // V29: 字幕の連動先（ADR-0032 決定24）。指しているのに見つからない／読み上げでないものを指している
    // ＝**黙って連動を解かない**（字幕は自分の文へ落ちて描かれ続けるので、消えたことに気づけない）。
    if (clip.voiceClipId != null) {
      const target = clipById.get(clip.voiceClipId);
      if (clip.kind !== TIMELINE_CLIP_KIND.subtitle) {
        warnings.push(warn('TIMELINE_SUBTITLE_LINK_ON_NON_SUBTITLE', '読み上げと連動できるのは字幕の部品だけです。字幕の部品に置き直してください', field));
      } else if (!target || !isVoiceClip(target)) {
        warnings.push(warn('TIMELINE_SUBTITLE_LINK_NOT_FOUND', '連動する読み上げが見つかりません。連動先を選び直すか、連動をやめてください', field));
      }
    }
  }

  // V24: 同一トラック内の時間の重なり。重ねたいならトラックを足す。
  // 3本以上が重なると同じクリップが複数の組に現れるので、後ろ側のクリップごとに1件へまとめる
  // （同じ場所に同じ案内を何度も出さない）。
  const overlapped = new Set(overlappingClipPairs(doc.clips).map(([, later]) => later.id));
  for (const id of overlapped) {
    warnings.push(warn('TIMELINE_CLIP_OVERLAP', '同じ列で時間が重なっています。ずらすか、列を増やして重ねてください', `clips.${id}`));
  }

  // V31: **同じ対象に動きは1本まで**（#717）。読む側（描画・キーフレーム編集・バラす）は `targetId` で
  // `find` して1本しか見ないので、2本あると**片方が黙って無視される**（焼き出しが切り替えを2本作って
  // ハードカットになっていた）。実装だけが持っていた前提を、検証で守る。
  const seenTargets = new Set<string>();
  for (const a of doc.animations ?? []) {
    if (seenTargets.has(a.targetId)) {
      warnings.push(warn('TIMELINE_ANIMATION_DUPLICATE', 'ひとつの部品に動きが2つ以上あります。あとの1つは動画に出ないので、動きを付け直してください', `animations.${a.id}`));
    }
    seenTargets.add(a.targetId);
  }

  // V32: **id は文書の中で一意**（#811・`11 §2.1`）。読む側は id で引き当てるので、重なると
  // **後勝ち／先勝ちが混ざって別のものに効く**（実測＝焼き出しでグループ id が重なり、片方の変形が
  // もう片方のメンバーに掛かって要素が画面外へ飛んだ）。しかも動きは `targetId` で合流して1本に混ざる。
  // ⚠️ **採番の穴は「作る側」で塞ぐのが本筋だが、ここでも見る**＝画面で知らせるため。
  // 保存を止めるのは門の側（`bakeToTimeline` が `duplicateIdsIn` を見る）＝**この検証は保存に
  // 効いていない**（自動保存が通すのは schema の適合だけ）。
  // 文言は種別で変えない（`15` の表と一字一句そろえる）＝どれが重なっても利用者の次の行動は同じ。
  // どこが重なったかは `field` が持つ。
  for (const field of duplicateIdsIn(doc)) {
    warnings.push(warn('TIMELINE_DUPLICATE_ID', '同じ部品が二重に入っていて、正しく表示できません。その部品を消して置き直すか、元の動画の「タイムラインで編集する形にする」から作り直してください', field));
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

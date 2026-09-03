// 帯を再生位置で分ける（#686 段階4・ADR-0034 決定16）。
//
// **kind で意味が違う**のが要点：
// - 絵（見た目パターン・素材・文字・図形・字幕）＝**時間を切るだけ**。
//   ⚠️ ただし**動き（キーフレーム）は再基準化し、分割点の値を両端に焼く**
//   （後半の時刻は自分の先頭からの秒なので、そのまま持ち越すと動きが飛ぶ）。
//   ⚠️ **動き方（カーブ）も前後へ切り分けて焼く**（#753）＝値だけ合っていて軌跡が別物、を作らない。
//   **表せない形（「両端ゆっくり」など）のときだけ断る**（近い形で置き換えない＝#262 と同じ流儀）。
// - 音＝**`sourceStartSec` を進める**（素材のどこから鳴らすかが後半でずれる）。
//   **フェードは前後に残す**（入りは前半・抜けは後半＝真ん中に切れ目の音を作らない）。
// - **読み上げは切れない**（文と音がずれる）。**連動している字幕も切れない**（読み上げが時間を決める）。
//
// 全列いっせいのブレード分割は**入れない**（決定16）＝対象は「選んでいる1つ」だけ。
import { createAnimationId, createClipId } from '../project/persistence';
import {
  easingCurveOf,
  interpolateKeyframes,
  isLinearCurve,
  KEYFRAME_PROPS,
  sameEasingCurve,
  splitEasingCurve,
} from '../project/keyframes';
import { TIMELINE_MIN_CLIP_SEC, VOLUME_POINTS_MAX } from '../constants';
import type { BezierEasing, EasingSpec } from '../enums';
import type { Keyframe } from '../project/types';
import type { ClipAnimation, TimelineClip, TimelineProject } from './types';
import type { Template } from '../template/types';
import { videoPlacementsOfClip } from './video';
import { isUnsplittableClipKind } from './clipKind';
// ⚠️ **頭出しの規則は1か所**（#988）＝トリムでも同じものを使う（写すと片方だけ直る）。
import { advancedSlotStarts, advancedSourceStart } from './sourceTime';
import { resolveSlotClip } from '../asset/clip';
import { clampProp } from './keyframeEdit';
import { EDIT_BLOCKED } from './edit';
import type { EditBlockedReason } from './edit';



/**
 * 切れ目が「キーフレームちょうど」と言える幅（＝保存の丸めの単位。`keyframeTimeAt` がマイクロ秒へ丸める）。
 * これより細かい差は同じ時刻とみなす＝丸めの都合で「区間の途中」に化けない。
 */
const KEYFRAME_SNAP_SEC = 1e-6;

/** 分けられない理由（`null`＝分けられる）。 */
export const SPLIT_BLOCKED = {
  /** 対象が見つからない。 */
  notFound: 'notFound',
  /** 列が固定されている。 */
  locked: 'locked',
  /** 読み上げ・連動している字幕は切れない（文と音・時間の持ち主がずれる）。 */
  unsplittable: 'unsplittable',
  /** 切れ目が帯の外／どちらかが短くなりすぎる。 */
  outside: 'outside',
  /** 音量の変化の点が上限に達している（境界の点を焼くと超える）。 */
  volumePointsFull: 'volumePointsFull',
  /**
   * **素材を使い切った先**で分けようとした（#816 レビュー 🔴）。後半の頭出しがそこまで進むと、
   * 切り出す終わりを追い越して**反転レンジ**になり、終端が「無し」へ正規化されて
   * **切り捨てたはずの先が流れ出す**（実尺を越える場合は書き出しが理由なく落ちる）。
   */
  pastSource: 'pastSource',
  /** その動き方を前後へ切り分けられない（#753＝表せない形・置けない値になる。カーブ自体は焼ける）。 */
  curvedEasing: 'curvedEasing',
} as const;
export type SplitBlockedReason = (typeof SPLIT_BLOCKED)[keyof typeof SPLIT_BLOCKED];

/**
 * **そこで分けられるか**（分けられないなら理由）。ドラッグの `moveClipIssue` と同じ流儀＝
 * 画面は押す前にこれを見て、`splitClip` も同じものを通す（押せるのに何も起きない、を作らない）。
 */
export function splitClipIssue(
  doc: TimelineProject,
  clipId: string,
  atSec: number,
  opts: { templateOf?: (templateId: string) => Template | undefined } = {},
): SplitBlockedReason | null {
  const clip = doc.clips.find((c) => c.id === clipId);
  if (!clip) return SPLIT_BLOCKED.notFound;
  if (doc.tracks.find((t) => t.id === clip.trackId)?.locked) return SPLIT_BLOCKED.locked;
  // 読み上げ＝文と音がずれる／連動している字幕＝時間は読み上げが決める（ADR-0032 決定24）。
  if (isUnsplittableClipKind(clip)) return SPLIT_BLOCKED.unsplittable;
  const head = atSec - clip.startSec;
  const tail = clip.startSec + clip.durationSec - atSec;
  // **どちらも最小の長さを満たすときだけ**（片方が潰れる切り方をさせない）。
  if (head < TIMELINE_MIN_CLIP_SEC || tail < TIMELINE_MIN_CLIP_SEC) return SPLIT_BLOCKED.outside;
  // ⚠️ **音量の点は上限を超えない**（#750 レビュー）＝境界の点を両端に焼くので、上限まで置いた帯を
  // 分けると片側が1つ超える。編集の入口（`volumePointEdit`）は「置けたのに書き出しで断られる」を
  // 作らないよう上限で断っているので、**分けるときだけ破らない**。
  const pts = clip.volumePoints ?? [];
  if (pts.length > 0) {
    const before = pts.filter((p) => p.timeSec < head).length + 1;
    const after = pts.filter((p) => p.timeSec > head).length + 1;
    if (before > VOLUME_POINTS_MAX || after > VOLUME_POINTS_MAX) return SPLIT_BLOCKED.volumePointsFull;
  }
  // ⚠️ **動き方（カーブ）を前後へ焼けないときだけ断る**（#753）。**焼けるかどうかは焼く関数自身が決める**
  // ＝`splitKeyframes` が `null` を返したときだけ断る（門と実物で規則が割れない・押せるのに何も起きない、も作らない）。
  const own = (doc.animations ?? []).find((a) => a.targetId === clipId);
  if (own && splitKeyframes(own.keyframes, head) == null) return SPLIT_BLOCKED.curvedEasing;
  // ⚠️ **素材を使い切った先では分けない**（#816 レビュー 🔴）＝後半の頭出しを進めると、
  // 切り出す終わり（`endSec`）を追い越して**反転レンジ**になり、`resolveSlotClip` が終端を
  // 「無し」へ正規化する＝**切り捨てたはずの先が後半で流れ出す**（元の音が入っていれば鳴り出す）。
  // 分ける前は最後のコマで凍っていたので、切っただけで絵が変わる（ADR-0026①）。
  // ⚠️ **素材の実尺も同じ**＝進めた先に絵が1枚も無いと、書き出しが「もう一度お試しください」で
  // 落ちる（何度やっても直らない案内＝§2-5）。**判る範囲だけ**で断る（尺が判らない素材は通す）。
  if (usesUpSource(doc, clip, head, opts.templateOf)) return SPLIT_BLOCKED.pastSource;
  return null;
}

/**
 * その切り方だと、**素材を使い切った先**から後半が始まるか（#816 レビュー 🔴）。
 *
 * 見るのは**置き場所ごとの実効値**（直接置き／差し込み口とも `videoPlacementsOfClip` 経由）＝
 * 継承（per-use → 素材既定）を解いた後の値で判断する（描画・再生と同じ材料）。
 * 判る材料が無い（終端も実尺も未指定）ときは**断らない**＝分からないことを理由にしない。
 */
function usesUpSource(
  doc: TimelineProject,
  clip: TimelineClip,
  headSec: number,
  templateOf: ((templateId: string) => Template | undefined) | undefined,
): boolean {
  return videoPlacementsOfClip(doc, clip, { templateOf }).some((p) => {
    const advanced = p.sourceStartSec + headSec * p.speed;
    const asset = doc.assets.find((a) => a.assetId === p.assetId);
    // ⚠️ **直接置きに「切り出す終わり」は無い**（#834-3）＝クリップが持つのは `sourceStartSec`/`speed` だけで
    // `endSec` に当たる項目が無い（`timeline-project.schema` の `TimelineClip`）。以前はここも
    // `resolveSlotClip` へ通していたが、上書きにも既定にも `endSec` が入らないので**必ず `undefined`**
    // ＝実質デッドコードで、「継承が抜けている」と誤読される形だった。
    // ⚠️ **素材既定（`asset.clip`）を足さない**＝`videoPlacementsOfClip` の直接置きの枝は
    // **クリップの値だけ**を読む（素材既定を効かせない）。ここだけが見ると、**画面では流れている先を
    // 門だけが「使い切った」と断る**＝描画・再生と同じ材料で判断する、が崩れる。
    // ⚠️ **見るのは「置き場所ごとの使い方を持つか」**＝`slotClips[層 id]` を持つ置き場所すべて。
    // ⚠️ **差し込み口だけに絞らない**（差分再監査 🟡・#809）＝**立ち絵も置き場所になった**（`use:'character'`）
    // ので、`use === slot` で絞ると**立ち絵に入れた動画の「ここまで」だけが効かない**（同じ入れ物・同じ
    // 解決〔`resolveSlotClip`〕を共有しているのに、この門だけ見ない＝ADR-0026②）。
    // かつては「直接置き／差し込み口の2種しか無いので挙動は同じ」と書いていたが、**もう事実ではない**。
    const endSec = p.layerId != null
      ? resolveSlotClip(clip.slotClips?.[p.layerId], asset?.clip).endSec
      : undefined;
    const sourceEnd = asset?.metadata?.durationSec ?? undefined;
    // 判る材料が無ければ限界は無限＝この比較は必ず偽になる（別に見張りを置かない＝守れない枝を作らない）。
    const limit = Math.min(endSec ?? Infinity, sourceEnd ?? Infinity);
    return advanced >= limit;
  });
}

/**
 * キーフレームの時刻は**マイクロ秒へ丸めて**保存する（`keyframeTimeAt`）ので、それより細かい差は
 * **同じ時刻**とみなす（#753 レビュー 🟡）。
 *
 * ⚠️ これが無いと、**開始秒しだいで結果が変わる**＝`headSec = atSec − clip.startSec` の引き算で
 * 1e-16 のずれが出るだけで「区間の途中」と見なされ、**幅ゼロの区間**として断られる。
 * 断り文言は「『動き』の欄に出ている秒数の位置で分けてください」と**まさにその操作を薦めている**ので、
 * 案内した次の行動へ到達できなくなる（§2-5・ADR-0026①）。再生位置のコマ量子化（1/30 秒）と
 * マイクロ秒丸めのずれ（3e-7 秒）も同じ理由でここへ落ちる。
 */
function snapToKeyframe(keyframes: readonly Keyframe[], atSec: number): number {
  const near = keyframes.find((k) => Math.abs(k.timeSec - atSec) <= KEYFRAME_SNAP_SEC);
  return near ? near.timeSec : atSec;
}

/**
 * 切れ目をまたぐ区間の**動き方をどう振り分けるか**（`null`＝振り分けられない＝分けない・#753）。
 *
 * ⚠️ **区間はプロパティごとに違う**（補間は「そのプロパティを持つKFだけ」で区間を作る）。
 * ⚠️ **区間 [前KF, 当KF] の動き方は「当KF」が持つ**（正典 `11 §7.6`）＝**出る側ではなく入る側**。
 */
interface EasingSplitPlan {
  /** 前半の切れ目のキーフレーム（＝前半の最後）に書く動き方。未指定＝直線。 */
  head?: EasingSpec;
  /** 後半で**またいだ区間の行き先**に書き直す動き方。未指定＝直線。 */
  tail?: EasingSpec;
  /** 書き直す相手（元の並びでの位置）。 */
  tailTargets: Set<number>;
}

function easingSplitPlan(keyframes: readonly Keyframe[], headSec: number): EasingSplitPlan | null {
  const crossings: { toIndex: number; frac: number; easing: EasingSpec | undefined }[] = [];
  for (const prop of KEYFRAME_PROPS) {
    const idx = keyframes
      .map((_, i) => i)
      .filter((i) => keyframes[i][prop] != null)
      .sort((a, b) => keyframes[a].timeSec - keyframes[b].timeSec);
    for (let j = 1; j < idx.length; j += 1) {
      const from = keyframes[idx[j - 1]];
      const to = keyframes[idx[j]];
      if (!(headSec > from.timeSec && headSec < to.timeSec)) continue;
      crossings.push({
        toIndex: idx[j],
        frac: (headSec - from.timeSec) / (to.timeSec - from.timeSec),
        easing: to.easing,
      });
      break; // 1つのプロパティが2つの区間をまたぐことはない
    }
  }

  // **切れ目ちょうど**にキーフレームがあるなら、そこへ入る区間の動き方は**切らずにそのまま**引き継ぐ
  // （そのキーフレームは境界へ置き換わるので、引き継がないと**手前の区間が直線に化ける**）。
  // ⚠️ **同じ時刻のキーフレームは1つ**（`11 §7.6.3.1`）＝引き継ぐ形も高々1つ。
  const atCut = keyframes.findIndex((k) => k.timeSec === headSec);
  const carries = atCut >= 0 && entersFromBefore(keyframes, atCut, headSec);

  // ⚠️ **またぐ区間が無いなら、そのまま引き継ぐ**（#802-1）＝曲線を切る必要が無いので、
  // 3次ベジェで表せない形（「両端ゆっくり」）でも**軌跡は厳密に変わらない**。
  // 以前はここでも表せるかを見て断っていたので、**焼き出したプリセット付きの部品**
  // （場面形式の既定が「両端ゆっくり」）は、キーフレームちょうどの位置ですら分けられなかった。
  // しかも断り文言は「『動き』の欄に出ている秒数の位置で分けてください」＝**まさにその操作**を
  // 薦めており、従うとまた断られる堂々巡りになっていた（§2-5）。
  if (crossings.length === 0) {
    const spec = carries ? keyframes[atCut].easing : undefined;
    // ⚠️ **直線は書かない**（レビュー ℹ️）＝未指定＝直線なので、書くと文書に余計な値が残る。
    // またぐ区間があるときの `isLinearCurve` 判定と揃える（「直線＝未指定」を片方だけ崩さない）。
    // ⚠️ 表せない形（`easingCurveOf` が `null`）は**そのまま持ち越す**＝ここが本題（#802-1）。
    const curve = spec !== undefined ? easingCurveOf(spec) : null;
    const keep = spec !== undefined && !(curve != null && isLinearCurve(curve));
    return { ...(keep ? { head: spec } : {}), tailTargets: new Set() };
  }

  // ここから先は**曲線を切る**ので、引き継ぐ形も「同じ形か」を比べられる必要がある。
  let head: BezierEasing['bezier'] | null = null;
  if (carries) {
    head = easingCurveOf(keyframes[atCut].easing);
    if (head == null) return null; // 表せない形は、切った部分曲線と突き合わせられない
  }

  let tail: BezierEasing['bezier'] | null = null;
  const tailTargets = new Set<number>();
  for (const c of crossings) {
    const cut = splitEasingCurve(c.easing, c.frac);
    if (cut == null) return null; // 表せない形（`ease-in-out` 等）
    // ⚠️ **前半は必ず1つ**＝切れ目のキーフレームは分割で新しく作る**1つの入れ物**なので、そこへ
    // 2つ以上の形が要るなら**分けない**（どれかを優先すると、優先しなかった側の動きが黙って変わる）。
    // 引き継ぐ形（切れ目ちょうどのキーフレーム）とも突き合わせる。
    if (head != null && !sameEasingCurve(head, cut.head)) return null;
    // ⚠️ **後半の突き合わせは、構造上の制約より広い**（レビュー指摘・#753）。書き直す相手は
    // またぐ区間ごとに**別のキーフレーム**なので、本当は別々の形を書いても矛盾しない。
    // それでも1つに揃えているのは、**前半が一致していて後半だけ食い違う組を作れなかった**ため
    // （12,280 通りの部分曲線を総当たりして、前半が 1e-9 まで一致する組は0件）。挙動が変わらない
    // 書き換えはその分岐を区別するテストが書けないので、**広いことを明記して残す**。
    // 緩めるときは `tail` を「行き先ごとの表」にする（書き込み側も行き先ごとに引く）。
    if (tail != null && !sameEasingCurve(tail, cut.tail)) return null;
    head = cut.head;
    tail = cut.tail;
    tailTargets.add(c.toIndex);
  }
  // ⚠️ **またいだ区間の行き先が、またがない区間の行き先でもある**とき、書き直すと**そちらの動きが変わる**。
  // （例＝後半だけで完結する区間が同じキーフレームへ入っている）。同じ形でなければ分けない。
  for (const i of tailTargets) {
    if (!servesSegmentInsideTail(keyframes, i, headSec)) continue;
    if (!sameEasingCurve(easingCurveOf(keyframes[i].easing), tail)) return null;
  }
  // 直線（＝進み具合を変えない）なら**書かない**（未指定＝直線＝いままでの形のまま）。
  const plan: EasingSplitPlan = { tailTargets };
  if (head != null && !isLinearCurve(head)) plan.head = { bezier: head };
  if (tail != null && !isLinearCurve(tail)) plan.tail = { bezier: tail };
  return plan;
}

/**
 * そのキーフレームへ、**切れ目より前**から入る区間があるか（＝前半で完結する区間の行き先か）。
 * その動き方は境界のキーフレームが引き継ぐ必要がある。
 */
function entersFromBefore(keyframes: readonly Keyframe[], index: number, headSec: number): boolean {
  const target = keyframes[index];
  return KEYFRAME_PROPS.some((prop) => {
    if (target[prop] == null) return false;
    return keyframes.some((k, i) => i !== index && k[prop] != null && k.timeSec < headSec);
  });
}

/**
 * そのキーフレームが、**切れ目より後ろだけで完結する区間**の行き先にもなっているか。
 * 切れ目ちょうどのキーフレームは境界へ吸収されるので、そこから入る区間も「後ろだけ」に含める。
 */
function servesSegmentInsideTail(keyframes: readonly Keyframe[], index: number, headSec: number): boolean {
  const target = keyframes[index];
  return KEYFRAME_PROPS.some((prop) => {
    if (target[prop] == null) return false;
    const prev = keyframes
      .filter((k, i) => i !== index && k[prop] != null && k.timeSec < target.timeSec)
      .sort((a, b) => a.timeSec - b.timeSec)
      .pop();
    return prev != null && prev.timeSec >= headSec;
  });
}

/**
 * 動きを前半・後半へ分ける（#686 段階4）。
 *
 * ⚠️ **分割点の値を両端に焼く**。前半の最後・後半の最初に「そのときの見た目」を置かないと、
 * 前半は最後のキーフレーム以降が止まり、後半は**自分の先頭から次のキーフレームまで一気に動く**
 * ＝切っただけなのに**絵が飛ぶ**。焼いておけば見た目は切る前と同じまま。
 *
 * 後半の時刻は**自分の先頭からの秒**へ直す（`11 §7.6.3.1`＝対象の先頭が起点）。
 */
export function splitKeyframes(
  keyframes: readonly Keyframe[],
  atSec: number,
): { head: Keyframe[]; tail: Keyframe[] } | null {
  if (keyframes.length === 0) return { head: [], tail: [] };
  const headSec = snapToKeyframe(keyframes, atSec);
  const plan = easingSplitPlan(keyframes, headSec);
  if (plan == null) return null;
  const at = interpolateKeyframes(keyframes, headSec);
  // ⚠️ **置けない値は焼かない**（切れ目の値が `Keyframe` として保存できる範囲を外れるなら分けない）。
  // 行き過ぎて戻るカーブは区間の**途中で端を越える**ので、そこで切ると濃さ 1.09・大きさ −0.07 のような
  // 値を焼くことになる＝schema が拒み、**分かれて見えるのに保存されない**文書になる（#753 レビュー 🔴）。
  // 収めて焼くと軌跡が変わるので、**断る側に倒す**（置ける値の規則は `keyframeEdit` と1つ）。
  for (const prop of KEYFRAME_PROPS) {
    const v = at[prop];
    if (v != null && clampProp(prop, v) !== v) return null;
  }
  // 補間は「指定の無いプロパティ」を返さない＝**元の並びが持っている項目だけ**を焼く
  // （持っていない項目を足すと、切っただけで動きの対象が増える）。
  const boundary: Keyframe = { timeSec: 0, ...at };
  const head = keyframes.filter((k) => k.timeSec < headSec).map((k) => ({ ...k }));
  // 前半の最後＝またいだ区間の**前半ぶんの動き方**が入る（区間の動き方は入る側が持つ）。
  head.push({ ...boundary, timeSec: headSec, ...(plan.head ? { easing: plan.head } : {}) });
  // 後半の先頭は**いちばん最初のキーフレーム**＝手前に区間が無いので動き方は持たない。
  const tail: Keyframe[] = [{ ...boundary }];
  keyframes.forEach((k, i) => {
    if (k.timeSec <= headSec) return;
    const moved: Keyframe = { ...k, timeSec: k.timeSec - headSec };
    if (plan.tailTargets.has(i)) {
      if (plan.tail) moved.easing = plan.tail;
      else delete moved.easing; // 後半ぶんが直線＝**元のカーブを残さない**（残すと動きが変わる）
    }
    tail.push(moved);
  });
  return { head, tail };
}

/** 音量の変化の点も同じ考え方で分ける（切れ目の音量を両端に焼く）。 */
export function splitVolumePoints(
  points: readonly { timeSec: number; volume: number }[] | undefined,
  headSec: number,
  volumeAtSplit: number | undefined,
): { head?: { timeSec: number; volume: number }[]; tail?: { timeSec: number; volume: number }[] } {
  if (!points || points.length === 0 || volumeAtSplit == null) return {};
  const head = points.filter((p) => p.timeSec < headSec).map((p) => ({ ...p }));
  head.push({ timeSec: headSec, volume: volumeAtSplit });
  const tail = [{ timeSec: 0, volume: volumeAtSplit }];
  for (const p of points) {
    if (p.timeSec <= headSec) continue;
    tail.push({ timeSec: p.timeSec - headSec, volume: p.volume });
  }
  return { head, tail };
}


/**
 * 帯を `atSec` で2つに分ける。**前半は同じ id のまま**（選択・動き・連動の参照が切れない）、
 * 後半を新しい id で足す。分けられないときは理由を返す。
 *
 * `volumeAt` は音量の変化を解く関数（`domain/timeline/audio` の `volumeAt`）。**再生・書き出しと
 * 同じもの**を渡す＝切れ目の音量が画面と出力で食い違わない。
 */
export function splitClip(
  doc: TimelineProject,
  clipId: string,
  atSec: number,
  volumeAt: (points: readonly { timeSec: number; volume: number }[] | undefined, localSec: number) => number | undefined,
  opts: { templateOf?: (templateId: string) => Template | undefined } = {},
): { ok: true; doc: TimelineProject; newClipId: string } | { ok: false; reason: SplitBlockedReason } {
  const issue = splitClipIssue(doc, clipId, atSec, opts);
  if (issue) return { ok: false, reason: issue };
  const clip = doc.clips.find((c) => c.id === clipId) as TimelineClip;
  const headSec = atSec - clip.startSec;
  const newId = createClipId(doc.clips.map((c) => c.id));

  const vol = splitVolumePoints(clip.volumePoints, headSec, volumeAt(clip.volumePoints, headSec));
  const head: TimelineClip = {
    ...clip,
    durationSec: headSec,
    // 入りのフェードは前半に残し、**抜けは後半へ渡す**（真ん中に切れ目の音を作らない）。
    ...(clip.fadeOutSec != null ? { fadeOutSec: undefined } : {}),
    ...(vol.head ? { volumePoints: vol.head } : {}),
  };
  const tail: TimelineClip = {
    ...clip,
    id: newId,
    startSec: atSec,
    durationSec: clip.startSec + clip.durationSec - atSec,
    ...(clip.fadeInSec != null ? { fadeInSec: undefined } : {}),
    ...(vol.tail ? { volumePoints: vol.tail } : {}),
    // **素材のどこから鳴らすか／映すか**を進める。速度が掛かっているぶんも進む
    // （置いた長さ × 速度 ＝ 使う素材の長さ・`11 §7.6.3.2`）。
    // ⚠️ **持っているかどうかで決めない**（#750 レビュー 🔴）＝置いたばかりの音は両方とも持たないので、
    // 条件にすると**後半が曲の頭から鳴り直す**。素材の時間を持つ種類なら**必ず書く**。
    ...advancedSourceStart(clip, headSec),
    // ⚠️ **差し込み口に入れた動画も進める**（#816-2）＝見た目パターンの部品は素材の時間を
    // クリップ自身でなく**置き場所ごと**（`slotClips[layerId].startSec`）に持つので、`kind` で
    // 判定すると取り残される＝**後半が前半と同じところから流れ直す**（絵も音も）。
    // 直接置いた動画は正しく進むので、放っておくと**同じ動画が置き場所で挙動が割れる**（ADR-0026②）。
    ...advancedSlotStarts(doc, clip, headSec, opts.templateOf),
  };
  // 連動している字幕は切れない（上で断っている）ので、`voiceClipId` を持つ後半は生まれない。

  const clips = doc.clips.flatMap((c) => (c.id === clipId ? [stripUndefined(head), stripUndefined(tail)] : [c]));

  const anims = doc.animations ?? [];
  const own = anims.find((a) => a.targetId === clipId);
  let animations: ClipAnimation[] | undefined = doc.animations;
  if (own) {
    const cut = splitKeyframes(own.keyframes, headSec);
    // 門（`splitClipIssue`）が同じ関数を通しているのでここへは来ないが、**黙って焼かずに進めない**
    // ＝動きが消えた帯を成功として返さない（§2-5）。
    if (cut == null) return { ok: false, reason: SPLIT_BLOCKED.curvedEasing };
    const { head: kfHead, tail: kfTail } = cut;
    const nextAnims = anims.map((a) => (a.id === own.id ? { ...a, keyframes: kfHead } : a));
    nextAnims.push({ id: createAnimationId(anims.map((a) => a.id)), targetId: newId, keyframes: kfTail });
    animations = nextAnims;
  }

  // ⚠️ **後半もまとまりに入れる**（#750 レビュー・3観点が独立に指摘）。描画はメンバーの id で
  // グループの変形・不透明度・**合成の単位**を解くので、入れないと**分割点から先だけ**
  // フェードや変形が外れる＝「切っただけで絵が変わる」（決定16 の核心）。
  // 消す側（`removeClips`）は参照を片づけるのに、分ける側が足さないのは非対称でもあった。
  const groups = doc.groups?.map((g) =>
    g.members.includes(clipId) ? { ...g, members: [...g.members, newId] } : g,
  );

  return {
    ok: true,
    doc: { ...doc, clips, ...(groups ? { groups } : {}), ...(animations ? { animations } : {}) },
    newClipId: newId,
  };
}

/** `undefined` の項目を落とす（schema は `additionalProperties:false`＝未定義の項目を書かない）。 */
function stripUndefined(clip: TimelineClip): TimelineClip {
  const out = { ...clip } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as unknown as TimelineClip;
}

/**
 * 分けられない理由 → 画面に出す断り（`EDIT_BLOCKED`）へ写す。
 * ⚠️ **写す表を1か所に置く**＝画面ごとに違う文言へ振り分けない（同じ状況で言うことが変わらない）。
 */
export const SPLIT_BLOCKED_REASON: Record<SplitBlockedReason, EditBlockedReason> = {
  [SPLIT_BLOCKED.notFound]: EDIT_BLOCKED.notFound,
  [SPLIT_BLOCKED.locked]: EDIT_BLOCKED.locked,
  [SPLIT_BLOCKED.unsplittable]: EDIT_BLOCKED.unsplittable,
  [SPLIT_BLOCKED.outside]: EDIT_BLOCKED.splitOutside,
  [SPLIT_BLOCKED.volumePointsFull]: EDIT_BLOCKED.volumePointsFull,
  [SPLIT_BLOCKED.curvedEasing]: EDIT_BLOCKED.curvedEasing,
  [SPLIT_BLOCKED.pastSource]: EDIT_BLOCKED.splitPastSource,
};

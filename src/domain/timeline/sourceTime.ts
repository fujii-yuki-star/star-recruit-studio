// **素材のどこから使うか**（頭出し）を進める規則（#988）。
//
// ⚠️ **1か所に置く**＝もとは「分ける」（`split.ts`）だけが持っていて、**左端のトリムは進めていなかった**。
// そのため **「ここで分けて前半を消す」と「左端をそこまで詰める」で、鳴る音・映る絵が違った**
//（同じ結果になるはずの2つの操作で結果が割れる）。写して直すと片方だけ直るので、**規則を共有する**。
//
// ⚠️ **他社の型でもトリムは頭出しを進める**（Premiere / CapCut＝research §2「端にカーソルを合わせるとトリム」）＝
// 進めないと、左端を詰めても**頭は切れず中身が右へずれ、代わりに末尾が落ちる**。
import { TIMELINE_CLIP_KIND } from '../enums';
import { videoPlacementsOfClip } from './video';
import { resolveSlotClip } from '../asset/clip';
import type { Template } from '../template/types';
import type { SlotClipOverride } from '../project/types';
import type { TimelineClip, TimelineProject } from './types';

/**
 * **素材の時間を持つ種類**（頭出しを進める相手）。
 * 文字・図形・字幕・見た目パターンは素材の時間を持たないので進めない（意味の無い項目を書かない）。
 */
export const USES_SOURCE_TIME = new Set<string>([TIMELINE_CLIP_KIND.audio, TIMELINE_CLIP_KIND.slot]);

/**
 * クリップ自身の頭出しを `headSec` ぶん進めた差分（進めない種類なら空）。
 *
 * ⚠️ **持っているかどうかで決めない**（#750 レビュー 🔴）＝置いたばかりで `sourceStartSec` が
 * 無いものを対象外にすると、**後半が曲の頭から鳴り直す**。素材の時間を持つ種類なら**必ず書く**。
 * ⚠️ **速度のぶんも進む**＝置いた長さ × 速度 ＝ 使う素材の長さ（`11 §7.6.3.2`）。
 */
export function advancedSourceStart(clip: TimelineClip, headSec: number): { sourceStartSec?: number } {
  if (!USES_SOURCE_TIME.has(clip.kind)) return {};
  return { sourceStartSec: clampSourceStart((clip.sourceStartSec ?? 0) + headSec * (clip.speed ?? 1)) };
}

/**
 * 素材の頭より前へは戻さない（0 で止める）。
 *
 * ⚠️ **負の値は意味が無いだけでなく、開けない動画を作る**＝素材の -2 秒は存在せず、
 * schema も 0 以上しか許さないので、**保存はできて次に開けない**（#974 と同じ形）。
 * ⚠️ **戻す向きを通すようにして初めて到達する**（進めるだけなら負にならなかった）。
 */
function clampSourceStart(sec: number): number {
  return sec > 0 ? sec : 0;
}

/**
 * 見た目パターンの**差し込み口に入れた動画**の頭出しを進めた差分（無ければ空）。
 *
 * ⚠️ **`kind` では判定できない**（#816-2）＝差し込み口の値はクリップ自身でなく
 * **置き場所ごと**（`slotClips[layerId].startSec`）に持つので、`kind` で絞ると取り残され、
 * **後半が前半と同じところから流れ直す**（直接置いた動画は進むので、**置き場所で挙動が割れる**）。
 * ⚠️ **立ち絵も置き場所として数える**（#809）＝`use === slot` で絞ると立ち絵だけ進まない。
 */
export function advancedSlotStarts(
  doc: TimelineProject,
  clip: TimelineClip,
  headSec: number,
  templateOf: ((templateId: string) => Template | undefined) | undefined,
): { slotClips?: Record<string, SlotClipOverride> } {
  if (clip.kind !== TIMELINE_CLIP_KIND.template) return {};
  const slots = videoPlacementsOfClip(doc, clip, { templateOf }).filter((p) => p.layerId != null);
  if (slots.length === 0) return {};
  const next: Record<string, SlotClipOverride> = { ...(clip.slotClips ?? {}) };
  for (const p of slots) {
    if (p.layerId == null) continue;
    next[p.layerId] = { ...(clip.slotClips?.[p.layerId] ?? {}), startSec: clampSourceStart(p.sourceStartSec + headSec * p.speed) };
  }
  return { slotClips: next };
}

/**
 * その切り方だと、**素材を使い切った先**から後半が始まるか（#816 レビュー 🔴）。
 *
 * 見るのは**置き場所ごとの実効値**（直接置き／差し込み口とも `videoPlacementsOfClip` 経由）＝
 * 継承（per-use → 素材既定）を解いた後の値で判断する（描画・再生と同じ材料）。
 * 判る材料が無い（終端も実尺も未指定）ときは**断らない**＝分からないことを理由にしない。
 *
 * ⚠️ **分けるときとトリムで共有する**（PR #1004 レビュー 🔴）＝もとは `split.ts` にしか無く、
 * **左端のトリムには移植されていなかった**（`EDIT_BLOCKED.splitPastSource` は定義だけで未使用）。
 * トリムも同じように頭出しを進めるので、**切り出す終わりを追い越すと `resolveSlotClip` が
 * 終端を「無し」へ正規化し、切り捨てたはずの素材の続きが黙って流れ出す**（#816 と同じ形）。
 * しかも**トリムのほうがドラッグで日常的に触る**ぶん、起こりやすい。
 * この規則を1か所へ置く、というのが `sourceTime.ts` の趣旨そのもの（写すと片方だけ直る）。
 */
export function usesUpSource(
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

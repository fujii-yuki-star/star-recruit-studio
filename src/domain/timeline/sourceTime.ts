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
  return { sourceStartSec: (clip.sourceStartSec ?? 0) + headSec * (clip.speed ?? 1) };
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
    next[p.layerId] = { ...(clip.slotClips?.[p.layerId] ?? {}), startSec: p.sourceStartSec + headSec * p.speed };
  }
  return { slotClips: next };
}

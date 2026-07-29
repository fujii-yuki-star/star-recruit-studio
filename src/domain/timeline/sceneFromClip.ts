// クリップを場面形式の `Scene` へ写す（ADR-0032・#629→#632）。純粋関数（副作用なし）。
//
// **描画（`layoutTimelineAt`）と「バラす」（`explodeTemplateClip`）が同じ写し方を通る**ための単一の参照元（§6）。
// 別々に書くと、バラした結果が元の絵と食い違う（同じ差し込み口を別の規則で読む）。
import { DEFAULT_CHARACTER_ID } from '../constants';
import { NARRATION_STATUS, TEXT_KEY, TIMELINE_CLIP_KIND } from '../enums';
import type { Scene } from '../project/types';
import type { Template } from '../template/types';
import type { TimelineClip } from './types';

/**
 * クリップを、場面形式の Scene へ写して `layoutScene` に渡せる形にする（**保存しない・このフレームの中だけ**）。
 *
 * `sceneType` は**実際に使う見た目の `category`** を入れる＝`11 §3.2`「`scene.sceneType` と `template.category` は
 * 同じ値集合を共有する」に合わせる（描画は `template.category` で分岐するので絵は変わらないが、
 * `sceneType` を読む規則〔例 `isFreeScene`〕と同じ形の後続コードが誤読しないようにする）。
 */
export function sceneFromClip(clip: TimelineClip, template: Template): Scene {
  return {
    // sceneId はこのフレームの中でだけ使う識別子。partId/warnings も器を満たすためのダミー（保存も検証もしない）。
    sceneId: clip.id,
    partId: '',
    order: 0,
    sceneType: template.category,
    templateId: clip.templateId ?? '',
    durationSec: clip.durationSec,
    assetRefs: clip.assetRefs ?? {},
    character: clip.character ?? { enabled: false, characterId: DEFAULT_CHARACTER_ID },
    texts: subtitleAwareTexts(clip),
    narration: { text: '', status: NARRATION_STATUS.none },
    warnings: [],
    ...(clip.textStyles ? { textStyles: clip.textStyles } : {}),
    ...(clip.slotFits ? { slotFits: clip.slotFits } : {}),
    ...(clip.textFontIds ? { textFontIds: clip.textFontIds } : {}),
    ...(clip.slotClips ? { slotClips: clip.slotClips } : {}),
    ...(clip.fontId != null ? { fontId: clip.fontId } : {}),
  };
}

/**
 * 字幕のクリップ（`kind:'subtitle'`）が持つ**焼き付けた文言**を、`texts.subtitle` として渡す。
 *
 * FREE 字幕要素は表示文を「対象（`subtitleSource`）」から解決する（ADR-0029）が、タイムライン形式に対象の語彙は
 * 無い（連動は #633）。焼き出し（#628 `staticSubtitleText`）は**時間で変わらない字幕を `clip.text` へ焼き付ける**ので、
 * ここで `texts.subtitle` に載せて既定の対象（＝読み上げ）から解決させる。これが無いと、
 * **「黙って消さない」ために焼き付けた字幕が受け側で1つも描かれない**（§2-5・#642 レビュー 🔴）。
 */
function subtitleAwareTexts(clip: TimelineClip): NonNullable<Scene['texts']> {
  const texts = clip.texts ?? {};
  if (clip.kind !== TIMELINE_CLIP_KIND.subtitle || !clip.text) return texts;
  return { ...texts, [TEXT_KEY.subtitle]: clip.text };
}

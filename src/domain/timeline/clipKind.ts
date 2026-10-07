// クリップの種別で決まる性質（ADR-0032）。**描く側と数える側で同じ判定を使う**ための1か所（#816-6）。
import { TIMELINE_CLIP_KIND } from '../enums';
import type { TimelineClipKind } from '../enums';
import type { TimelineClip } from './types';

/**
 * 映像として描くクリップか（音だけのものは絵を持たない）。
 *
 * **網羅 switch**（`never` チェック）で書くのは、`TimelineClipKind` に種別が増えたとき「映像扱いのまま
 * 描き方が無く黙って何も出ない」を型で止めるため（ADR-0032 決定19 の取りこぼし防止と同じ流儀）。
 *
 * ⚠️ **描画（`timelineCanvasClipsAt`）と、鳴らす側（`isDrawnClip`）が同じものを見る**（#816-6）＝
 * 別々に書くと、片方だけが数えた部品で**プレビューは無音・書き出しは有音**になる（ADR-0001）。
 */
export function isVisualClip(clip: TimelineClip): boolean {
  const kind: TimelineClipKind = clip.kind;
  switch (kind) {
    case TIMELINE_CLIP_KIND.slot:
    case TIMELINE_CLIP_KIND.text:
    case TIMELINE_CLIP_KIND.shape:
    case TIMELINE_CLIP_KIND.subtitle:
    case TIMELINE_CLIP_KIND.template:
      return true;
    case TIMELINE_CLIP_KIND.audio:
    case TIMELINE_CLIP_KIND.voice:
      return false;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/**
 * その部品は**そもそも**分けられない種類か（位置に関わらず＝分割の入口 `splitClipIssue` と、
 * 分けを案内してよいかの判定〔#831〕が同じものを見るための1か所）。
 * 読み上げ＝文と音がずれる／連動している字幕＝時間は読み上げが決める（ADR-0032 決定24）。
 */
export function isUnsplittableClipKind(clip: TimelineClip): boolean {
  return clip.kind === TIMELINE_CLIP_KIND.voice || clip.voiceClipId != null;
}

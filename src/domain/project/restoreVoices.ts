// 戻したときに、**文と音の食い違い**を残さない（#967 レビュー 🟡2）。
//
// ⚠️ **音のファイルは戻らない**＝読み上げの音は `voices/<場面や行の id>.wav` という**決まった名前**で保存され、
// 作り直すたびに**同じファイルを上書き**する。だから復元ポイントへ戻すと、
// **セリフは戻った文なのに、音はいまの文で作ったもの**になりうる。
// ⚠️ **これは「見つからない」ではなく「中身が食い違う」**＝素材の欠けを見る仕組み（`ASSET_FILE_MISSING`）では
// 拾えず、`status` も「作成済み」のままなので、**そのまま書き出すと字幕と声が違う動画が出る**（§2-5）。
//
// ⚠️ **戻す時点では、どちらの文も手元にある**（戻す内容といまの内容）ので、
// **文が変わっている読み上げだけ**「作成前」に戻せば足りる（全部作り直させない）。
import { NARRATION_STATUS } from '../enums';
import type { Project, Scene } from './types';

/** 「作成済み」の扱いを取り消して、作り直しが要ると分かる形にする。 */
function unmade<T extends { status?: string; voicePath?: string | null }>(v: T): T {
  return { ...v, status: NARRATION_STATUS.none, voicePath: null };
}

/** 場面ごとの、読み上げの文（単独＋掛け合いの各行）。 */
function textsOf(scene: Scene): { narration: string; lines: Map<string, string> } {
  return {
    narration: scene.narration?.text ?? '',
    lines: new Map((scene.lines ?? []).map((l) => [l.lineId, l.text])),
  };
}

/** 戻したことで、音と食い違う読み上げの数。 */
export interface StaleVoiceCount {
  /** 作り直しが要る読み上げの数（単独＋行）。 */
  readonly cleared: number;
}

/**
 * 戻す内容のうち、**いまの音と食い違う読み上げ**を「作成前」に戻す（純粋）。
 *
 * ⚠️ **文が同じものは触らない**＝いまの音はその文で作ったものなので、そのまま使える
 * （戻すたびに全部作り直させると、戻すこと自体が重すぎて使われなくなる）。
 * ⚠️ **いまに無い場面・行は触らない**＝音のファイルも無いので、`status` は戻す内容のままでよい。
 */
export function clearStaleVoices(
  restored: Project,
  current: Project,
): { project: Project; count: StaleVoiceCount } {
  const now = new Map((current.scenes ?? []).map((s) => [s.sceneId, textsOf(s)]));
  let cleared = 0;
  const scenes = (restored.scenes ?? []).map((s) => {
    const cur = now.get(s.sceneId);
    if (!cur) return s; // いまに無い場面＝音のファイルも無い
    let next = s;
    if (s.narration?.status === NARRATION_STATUS.generated && cur.narration !== (s.narration.text ?? '')) {
      next = { ...next, narration: unmade(s.narration) };
      cleared += 1;
    }
    if (s.lines && s.lines.length > 0) {
      let touched = false;
      const lines = s.lines.map((l) => {
        const curText = cur.lines.get(l.lineId);
        if (l.status !== NARRATION_STATUS.generated || curText === undefined || curText === l.text) return l;
        touched = true;
        cleared += 1;
        return unmade(l);
      });
      if (touched) next = { ...next, lines };
    }
    return next;
  });
  return { project: { ...restored, scenes }, count: { cleared } };
}

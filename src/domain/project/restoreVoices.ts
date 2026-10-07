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
import { resolveLineVoice, resolveNarrationVoice, sameSynthInput } from '../voice/voiceProvider';
import type { SynthesizeInput } from '../voice/voiceProvider';
import type { Project, Scene, VoiceSettings } from './types';

/** 「作成済み」の扱いを取り消して、作り直しが要ると分かる形にする。 */
function unmade<T extends { status?: string; voicePath?: string | null }>(v: T): T {
  return { ...v, status: NARRATION_STATUS.none, voicePath: null };
}

/**
 * 場面ごとの、**声を作るときの入力**（単独＋掛け合いの各行）。
 *
 * ⚠️ **文だけ比べない**（#967 レビュー 🟡）＝同じ文でも**話者・速さ・高さ・抑揚**が変われば、
 * できあがる音は別物になる。文だけを見ていると、
 * 「セリフは同じなのに、鳴るのは別の声」という**同じ種類の食い違い**が別の道から戻ってくる。
 * ⚠️ **継承をほどいてから比べる**＝行や場面が未指定（null）のときは動画全体の設定を継ぐので、
 * **全体の設定だけが変わった**ときも取りこぼさない。
 * ⚠️ **比べ方は既存のものを使う**（`resolveNarrationVoice` / `resolveLineVoice` / `sameSynthInput`）＝
 * 声を作り直すかどうかの判定は既に2か所（`affectsVoice` / `sameSynthInput`）にあり、
 * ここで3つ目の規則を書くと、また食い違う。
 */
function voiceInputsOf(
  scene: Scene,
  // ⚠️ **欠けていても落ちない**＝ここで投げると、戻す側が握って**元の（食い違う）内容をそのまま書く**
  // ＝直したはずの不具合が、黙って戻ってくる。
  voice: Partial<VoiceSettings>,
): { narration: SynthesizeInput | null; lines: Map<string, SynthesizeInput> } {
  const base = scene.narration ? resolveNarrationVoice(scene.narration, voice as VoiceSettings) : null;
  return {
    narration:
      scene.narration && base ? { text: scene.narration.text, ...base, speaker: null } : null,
    lines: new Map(
      (scene.lines ?? []).map((l) => [
        l.lineId,
        resolveLineVoice(l, base ?? resolveNarrationVoice({ text: '' } as Scene['narration'], voice as VoiceSettings)),
      ]),
    ),
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
 * ⚠️ **いまに無い場面・行は「作成前」へ倒す**（#975 レビューで説明のズレを直した）＝
 * 読み上げの WAV（`voices/…`）は**場面や行を消しても残る**ので、素通りさせると
 * 「文は戻った・音はいまの文」が復活する。⚠️ **比べようが無いので、分からない側へ倒す**。
 */
export function clearStaleVoices(
  restored: Project,
  current: Project,
): { project: Project; count: StaleVoiceCount } {
  // ⚠️ **それぞれの文書の設定で解く**＝戻す内容といまの内容で、動画全体の声の設定が違うことがある。
  const now = new Map(
    (current.scenes ?? []).map((s) => [s.sceneId, voiceInputsOf(s, current.voiceSettings ?? {})]),
  );
  let cleared = 0;
  const scenes = (restored.scenes ?? []).map((s) => {
    const cur = now.get(s.sceneId);
    if (!cur) {
      // ⚠️ **いまに無い場面でも、音のファイルは残っている**（α-7 出口監査 🟡）＝
      // 読み上げの WAV を消す経路は（動画ごと消す以外に）無く、`voices/<場面 id>.wav` は
      // **場面を消しても残る**。ここを素通りさせると「文は戻った・音はいまの文」が復活する。
      // ⚠️ **比べようが無いので、分からない側へ倒す**（作り直しが要ると知らせる）。
      let touched = false;
      let next = s;
      if (s.narration?.status === NARRATION_STATUS.generated) {
        next = { ...next, narration: unmade(s.narration) };
        cleared += 1;
        touched = true;
      }
      if (s.lines && s.lines.length > 0) {
        const lines = s.lines.map((l) => {
          if (l.status !== NARRATION_STATUS.generated) return l;
          cleared += 1;
          touched = true;
          return unmade(l);
        });
        if (touched) next = { ...next, lines };
      }
      return next;
    }
    const mine = voiceInputsOf(s, restored.voiceSettings ?? {});
    let next = s;
    if (
      s.narration?.status === NARRATION_STATUS.generated &&
      mine.narration != null &&
      (cur.narration == null || !sameSynthInput(mine.narration, cur.narration))
    ) {
      next = { ...next, narration: unmade(s.narration) };
      cleared += 1;
    }
    if (s.lines && s.lines.length > 0) {
      let touched = false;
      const lines = s.lines.map((l) => {
        const curInput = cur.lines.get(l.lineId);
        const myInput = mine.lines.get(l.lineId);
        if (l.status !== NARRATION_STATUS.generated || myInput === undefined) return l;
        // ⚠️ **いまに無い行も、分からない側へ倒す**（α-7 再監査 🟡・場面と同じ扱い）＝
        // 読み上げの WAV（`voices/<場面>__<行>.wav`）は**行を消しても残る**ので、素通りさせると
        // 〈行の文を直して作り直す → その行を消す → 前の時点へ戻す〉で
        // **字幕は戻った文・音はいまの文**が復活する（場面について書いた理由がそのまま当てはまる）。
        if (curInput !== undefined && sameSynthInput(myInput, curInput)) return l;
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

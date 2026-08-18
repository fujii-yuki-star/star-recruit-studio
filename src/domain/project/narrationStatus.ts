// 読み上げ音声の**印**（`status`）の決め方（純粋・副作用なし・§7 テスト対象）。
//
// ⚠️ **印は文書に残る**＝一時的な失敗をそのまま書くと、開き直しても「声を作れませんでした」と出続ける。
// ところが**鳴らす側・書き出す側が見ているのは音声ファイル**（`voicePath`／`audioSourcesOf`）なので、
// 前に作った声が残っていれば**そのまま鳴って動画にも入る**＝「作れませんでした」と言いながら声が鳴る、
// という食い違いが永続化されていた（#755-3）。
//
// 文や話者を変えたときは音声が外れる（`setVoiceText`／`lineEditOps`）ので、**失敗したときに声が残って
// いるなら、その声はいまの文のもの**＝使える。だから印は「作れている」のままが正しい。
import { NARRATION_STATUS } from '../enums';
import type { NarrationStatus } from '../enums';

/**
 * 声を作れなかったときに**残す印**。
 *
 * - 使える声が残っている（`voicePath` がある）＝**印は変えない**（`generated`）。失敗は**その場の知らせ**で
 *   伝える＝文書に嘘を書かない（§2-5・ADR-0026①「設定した意味どおり」）。
 * - 声が無い＝`failed`（作れていないことを次に開いたときも知らせる）。
 */
export function statusAfterVoiceFailure(voicePath: string | null | undefined): NarrationStatus {
  return voicePath ? NARRATION_STATUS.generated : NARRATION_STATUS.failed;
}

/** 失敗の知らせに「前の声はそのまま使える」を添えるか（残っているときだけ言う）。 */
export function keptPreviousVoice(voicePath: string | null | undefined): boolean {
  return !!voicePath;
}

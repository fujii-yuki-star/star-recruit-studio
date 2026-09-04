import { isExportBusy, useProjectStore } from "../store/projectStore";
import { useBulkVoiceControlsPresence } from "../hooks/useBulkVoicePresence";
import { narrationProgress } from "../../domain/voice/narrationProgress";
import { sceneNeedsVoice } from "../../domain/project/narrationLines";
import {
  BULK_VOICE_BUSY_LABEL, BULK_VOICE_CANCEL_LABEL, BULK_VOICE_LABEL,
  bulkVoiceDisabledReason, bulkVoiceProgressText,
} from "../uiLabels";

/**
 * 「声をまとめて作る」の共通操作（#547 P2-6）。たたき台・場面編集・公開前チェックの3画面が使う。
 *
 * 3画面がそれぞれ進捗表示・ボタン文言・無効条件を持っていたため、**同じ操作なのに画面ごとに違って見えた**
 * （公開前チェックには進捗が無い／「作成中…」と「準備中…」が混在／書き出し中の無効化が片方だけ）。
 * ここに寄せて同概念同挙動にする（ADR-0026②・§6）。
 *
 * **中止**（`cancelNarrationGeneration`）は「これ以上作らない」だけで、できあがった声は取り消さない。
 * 一括作成は同時実行数を絞って走るので、押せば待機列の残りが実際に止まる（ADR-0026④「押せるのに効かない」を作らない）。
 * 中止後は進捗が「声 5/10（中止しました）」になり、作った声が残っていることが数字で分かる。
 *
 * 既定は断片（Fragment）＝進捗・ボタン列を置く場所は各画面のレイアウトに任せる（上部バーの横並び／表の縦積みの
 * どちらでも使える）。`rowClassName` を渡すと自前の行で包み、**隠すときは行ごと消える**（空の行の余白を残さない）。
 */
export function BulkVoiceControls({
  label = BULK_VOICE_LABEL,
  buttonClassName = "btn btn-primary",
  rowClassName,
  hideWhenNothingToDo = false,
  onFinished,
}: {
  /** 通常時のボタン文言。公開前チェックは検査項目側の導線名（「声を作成」）を渡す。 */
  label?: string;
  /** ボタンの見た目（画面ごとの主/副の位置づけに合わせる）。 */
  buttonClassName?: string;
  /** 指定すると中身をこの class の行で包む。隠れるときは行ごと出さない（空の行に余白だけ残さない）。 */
  rowClassName?: string;
  /** 作る声が無く何も起きていないとき、操作ごと出さない。専用の行を持つ画面（たたき台）向け。 */
  hideWhenNothingToDo?: boolean;
  /** 一括作成が終わったとき（中止で打ち切られた場合も含む）。画面ごとの完了通知に使う。 */
  onFinished?: (result: { cancelled: boolean }) => void;
}) {
  // ⚠️ **早期 return より前で数える**＝`hideWhenNothingToDo` で何も描かないときも「居る」
  // （その画面には操作の置き場所があるので、作り始めれば出る＝全画面バナーと二重にならない）。
  useBulkVoiceControlsPresence();
  const scenes = useProjectStore((s) => s.scenes);
  const generating = useProjectStore((s) => s.isGeneratingNarration);
  const cancelled = useProjectStore((s) => s.narrationCancelled);
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase));
  const generateAllNarrations = useProjectStore((s) => s.generateAllNarrations);
  const cancelNarrationGeneration = useProjectStore((s) => s.cancelNarrationGeneration);
  const { done, total } = narrationProgress(scenes);
  // 作る対象があるか。一括作成の対象判定（sceneNeedsVoice）を store と共有＝「押せるのに何も起きない」を作らない
  // （ADR-0026④）。掛け合いも行ごとに見る（#403）。
  const needsVoice = scenes.some(sceneNeedsVoice);
  const disabledReason = bulkVoiceDisabledReason({ isExporting, generating, needsVoice, hasNarrationText: total > 0 });
  // 全部できて何も起きていないときは進捗を出さない（3画面に散っていた同じ条件をここへ集約）。
  const showProgress = total > 0 && (generating || cancelled || done < total);

  const run = async () => {
    await generateAllNarrations();
    onFinished?.({ cancelled: useProjectStore.getState().narrationCancelled });
  };

  if (hideWhenNothingToDo && !needsVoice && !generating && !cancelled) return null;

  const content = (
    <>
      {showProgress && (
        <span className="text-sm text-muted">
          {bulkVoiceProgressText(done, total, generating ? "generating" : cancelled ? "cancelled" : "idle")}
        </span>
      )}
      <span className="row gap-sm">
        <button
          className={buttonClassName}
          onClick={() => void run()}
          disabled={generating || isExporting || !needsVoice}
          title={disabledReason}
        >
          {generating ? BULK_VOICE_BUSY_LABEL : label}
        </button>
        {/* 中止は作成中だけ出す（押せない中止ボタンを常設しない）。 */}
        {generating && (
          <button className="btn btn-ghost text-sm" onClick={() => cancelNarrationGeneration()}>
            {BULK_VOICE_CANCEL_LABEL}
          </button>
        )}
      </span>
    </>
  );
  return rowClassName ? <div className={rowClassName}>{content}</div> : content;
}

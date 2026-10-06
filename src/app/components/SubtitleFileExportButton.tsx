// 字幕ファイル（.srt／.vtt）を書き出すボタン（ADR-0055 決定4・#1351）。タイムライン形式と場面形式で共有する。
//
// ⚠️ **取り出し方は呼ぶ側が1つの関数（`subtitleCuesOf`）から渡す**＝場面形式は焼き出しを通してから同じ関数へ。
// ⚠️ **押した結果は必ず言う**（§2-5）＝書けた数・何も無い・保存できなかった。閉じた（キャンセル）ときだけ黙る。
import { useState } from "react";
import type { SubtitleCue } from "../../domain/subtitle/subtitleFile";
import { saveSubtitleFile } from "../../infrastructure/subtitleFileFs";
import { SUBTITLE_FILE_EXPORT_HINT, SUBTITLE_FILE_EXPORT_LABEL, subtitleExportedMessage, subtitleFileMessage } from "../uiLabels";

export function SubtitleFileExportButton({ cuesOf, defaultName, disabledReason, onMessage, className = "btn btn-secondary" }: {
  /** 押したときの字幕（押した時点の中身で取り出す）。 */
  cuesOf: () => SubtitleCue[];
  /** 保存先の初期のファイル名（拡張子なし）。 */
  defaultName: string;
  /** 押せない理由（押せるなら null）。 */
  disabledReason: string | null;
  /** 結果の知らせ（`ok`＝書けた）。 */
  onMessage: (message: string, ok: boolean) => void;
  className?: string;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={disabledReason != null || saving}
      title={disabledReason ?? SUBTITLE_FILE_EXPORT_HINT}
      onClick={async () => {
        const cues = cuesOf();
        if (cues.length === 0) { onMessage(subtitleFileMessage.SUBTITLE_FILE_NOTHING_TO_EXPORT, false); return; }
        setSaving(true);
        try {
          const r = await saveSubtitleFile(cues, defaultName.trim() || "export");
          if (r.saved) onMessage(subtitleExportedMessage(r.count), true);
        } catch {
          onMessage(subtitleFileMessage.SUBTITLE_FILE_SAVE_FAILED, false);
        } finally {
          setSaving(false);
        }
      }}
    >
      {SUBTITLE_FILE_EXPORT_LABEL}
    </button>
  );
}

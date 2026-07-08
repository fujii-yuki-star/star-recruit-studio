// ナレーション（読み上げの声）全体の音量スライダー。書き出し画面と仕上がり確認で共用する（#407・DRY）。
// 値は voiceSettings.volume（動画全体の既定・§6）。0〜1.5 を許容し、>1.0 は書き出し/プレビューとも増幅で一致（#452）。
import { NARRATION_VOLUME, VOLUME_MAX, VOLUME_MIN, VOLUME_STEP } from "../../domain/constants";
import { useHistoryGroup } from "../hooks/useHistoryGroup";

export function NarrationVolumeControl({
  volume,
  onChange,
  hint,
}: {
  volume: number | null | undefined;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const v = volume ?? NARRATION_VOLUME;
  // ドラッグ中の連続変更を1履歴にまとめる（#389）。
  const { dragGroup } = useHistoryGroup();
  return (
    <div className="field">
      <label className="field-label" htmlFor="narrationVolume">
        ナレーション音量
      </label>
      <input
        id="narrationVolume"
        type="range"
        min={VOLUME_MIN}
        max={VOLUME_MAX}
        step={VOLUME_STEP}
        value={v}
        {...dragGroup}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "var(--color-primary)" }}
      />
      <div className="row-between text-faint text-sm">
        <span>小さい</span>
        <span>{Math.round(v * 100)}%（標準100%）</span>
        <span>大きい</span>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

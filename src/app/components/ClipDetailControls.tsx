import type { Asset, Clip, SlotClipOverride } from "../../domain/project/types";
import { clampClipTime } from "../../domain/asset/clip";
import { formatDuration } from "../../domain/format/duration";
import {
  ORIGINAL_AUDIO_VOLUME, SPEED_DEFAULT, SPEED_MAX, SPEED_MIN, SPEED_STEP,
  VOLUME_MAX, VOLUME_MIN, VOLUME_STEP,
} from "../../domain/constants";
import { useHistoryGroup } from "../hooks/useHistoryGroup";
import { Switch } from "./ui";
import { NumberField } from "./NumberField";

// このカードが編集するのは範囲/速度/元音声のみ（fit は含めない＝per-use fit は呼び出し側の FitSelect が slotFits/el.fit へ・#472 P1）。
type ClipPatch = Partial<SlotClipOverride>;

// 動画クリップの調整カード（収め方・使う範囲・再生速度・元音声・元音声の音量）。
// 表示する実効クリップ（clip）と編集先の振り分け（patchClip）は呼び出し側が渡す（ADR-0028・#472）：
//   場面編集＝clip は resolveSlotClip(scene.slotClips, asset.clip) の実効値・patchClip は範囲/速度/音声を scene.slotClips へ
//     （scenes 更新＝ADR-0020 履歴で Undo 可）／fit は #472 対象外ゆえ asset.clip のまま。
//   素材画面＝clip は asset.clip・patchClip は全て asset.clip（素材の既定＝Undo 対象外）。
export function ClipDetailControls({
  asset,
  clip,
  patchClip,
  scope = "material",
}: {
  asset: Asset;
  /** 表示する実効クリップ（場面=resolveSlotClip 結果／素材=asset.clip）。未上書きは継承値がプレースホルダとして出る（#472）。 */
  clip: Clip | undefined;
  patchClip: (p: ClipPatch) => void;
  /** 編集の性質。'material'（既定）は §2-5 で「元に戻せません（全場面の既定が変わる）」を出す。'scene' は per-use＝Undo 可。 */
  scope?: "scene" | "material";
}) {
  const dur = asset.metadata?.durationSec ?? null;
  const hasAudio = asset.metadata?.hasAudio === true;
  const useOriginal = hasAudio && (clip?.useOriginalAudio ?? false);
  // ドラッグ中の連続変更（速度/音量スライダー）を1履歴に合成（#389・場面側は Undo 可＝ADR-0028 D5）。素材側は asset を
  // 履歴に積まないので dragGroup は実質 no-op（無害）。
  const { dragGroup } = useHistoryGroup();
  return (
    <div className="card-tight" style={{ background: "var(--color-surface-alt)", marginTop: 6 }}>
      <p className="text-sm text-muted" style={{ margin: "0 0 6px" }}>
        ▶ 動画素材です。仕上がり確認では、再生すると動画が流れます（停止中は表示されません）。書き出しにも動画が入ります。
        {dur != null && `（長さ：約${formatDuration(dur)}）`}
      </p>
      {scope === "material" && (
        // 素材の既定を編集＝全場面に効く・取り消せない（ADR-0028 D3・§2-5）。場面編集側（scope='scene'）は per-use＝Undo 可。
        <p className="field-hint" style={{ margin: "0 0 6px" }}>
          ここでの変更は元に戻せません（この素材を使う<strong>すべての場面の既定</strong>が変わります）。場面ごとに変えるときは、その場面の編集で調整してください。
        </p>
      )}
      {/* 「枠への収め方（fit）」はこのカードでは扱わない：fit は per-use（場面=scene.slotFits／FREE=el.fit・layoutScene が読む）で
          画像スロットと同じ FitSelect（呼び出し側）に集約する（#472 P1）。asset.clip.fit は静止レイアウトが読めず割れるため使わない。 */}

      {/* 使う範囲 */}
      <div className="field" style={{ marginBottom: 6 }}>
        <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>
          使う範囲（秒）
        </label>
        {/* 開始/終了は共有 NumberField（#459・blur 確定・空/NaN は元値へ／終了は空でクリア＝最後まで）。 */}
        <div className="row gap-sm" style={{ alignItems: "center" }}>
          <NumberField
            value={clip?.startSec ?? 0}
            min={0}
            max={dur ?? undefined}
            step={0.1}
            onChange={(v) => {
              const start = clampClipTime(v, dur);
              // 開始が終了を超えたら終了をクリア（=最後まで）して無効状態を防ぐ。
              const p: ClipPatch = { startSec: start };
              if (clip?.endSec != null && start > clip.endSec) p.endSec = undefined;
              patchClip(p);
            }}
          />
          <span className="text-sm text-muted">〜</span>
          <NumberField
            value={clip?.endSec}
            min={0}
            max={dur ?? undefined}
            step={0.1}
            placeholder="最後まで"
            onChange={(v) => patchClip({ endSec: clampClipTime(v, dur, clip?.startSec ?? 0) })}
            onClear={() => patchClip({ endSec: undefined })}
          />
        </div>
        <p className="field-hint">終了を空にすると最後まで使います。</p>
      </div>

      {/* 再生速度（A=尺独立：表示時間は変えず、クリップの再生速度だけ変える） */}
      <div className="field" style={{ marginBottom: 6 }}>
        <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>
          再生速度
        </label>
        <input
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={SPEED_STEP}
          value={clip?.speed ?? SPEED_DEFAULT}
          onChange={(e) => patchClip({ speed: Number(e.target.value) })}
          {...dragGroup}
          style={{ width: "100%", accentColor: "var(--color-primary)" }}
        />
        <div className="row-between text-faint text-sm">
          <span>ゆっくり</span>
          <span>{clip?.speed ?? SPEED_DEFAULT}倍</span>
          <span>はやく</span>
        </div>
      </div>

      {/* 元の音声 */}
      <div className="toggle-row">
        <span className="field-label text-sm" style={{ margin: 0 }}>
          元の音声を使う
        </span>
        <Switch
          on={useOriginal}
          disabled={!hasAudio}
          onChange={(v) => patchClip({ useOriginalAudio: v })}
          label="元の音声を使う"
        />
      </div>
      {!hasAudio && (
        <p className="field-hint">
          {asset.metadata?.hasAudio === false
            ? "この動画には音声がありません。"
            : "音声を確認できないため、元の音声は使えません。"}
        </p>
      )}

      {/* 元音声の音量 */}
      {useOriginal && (
        <div className="field" style={{ marginTop: 6 }}>
          <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>
            元の音声の大きさ
          </label>
          <input
            type="range"
            min={VOLUME_MIN}
            max={VOLUME_MAX}
            step={VOLUME_STEP}
            value={clip?.originalAudioVolume ?? ORIGINAL_AUDIO_VOLUME}
            onChange={(e) => patchClip({ originalAudioVolume: Number(e.target.value) })}
            {...dragGroup}
            style={{ width: "100%", accentColor: "var(--color-primary)" }}
          />
          <div className="row-between text-faint text-sm">
            <span>小さい</span>
            <span>
              {Math.round((clip?.originalAudioVolume ?? ORIGINAL_AUDIO_VOLUME) * 100)}
              %（標準{Math.round(ORIGINAL_AUDIO_VOLUME * 100)}%）
            </span>
            <span>大きい</span>
          </div>
        </div>
      )}
    </div>
  );
}

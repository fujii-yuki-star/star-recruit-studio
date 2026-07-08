import type { Asset } from "../../domain/project/types";
import { clampClipTime } from "../../domain/asset/clip";
import { formatDuration } from "../../domain/format/duration";
import {
  DEFAULT_FIT, ORIGINAL_AUDIO_VOLUME, SPEED_DEFAULT, SPEED_MAX, SPEED_MIN, SPEED_STEP,
  VOLUME_MAX, VOLUME_MIN, VOLUME_STEP,
} from "../../domain/constants";
import { Switch } from "./ui";
import { FitSelect } from "./FitSelect";
import { NumberField } from "./NumberField";

type ClipPatch = Partial<NonNullable<Asset["clip"]>>;

// 動画クリップの調整カード（収め方・使う範囲・再生速度・元音声・元音声の音量）。
// クリップ設定は Asset 単位（正典 11/$defs/Clip）。通常スロットと FREE スロットで共用する。
export function ClipDetailControls({
  asset,
  patchClip,
}: {
  asset: Asset;
  patchClip: (p: ClipPatch) => void;
}) {
  const clip = asset.clip;
  const dur = asset.metadata?.durationSec ?? null;
  const hasAudio = asset.metadata?.hasAudio === true;
  const useOriginal = hasAudio && (clip?.useOriginalAudio ?? false);
  // 注: クリップ設定は Asset（asset.clip）を更新する。ADR-0020 の Undo 履歴 slice は meta/parts/scenes のみで
  // assets は対象外のため、これらの調整は現状 Undo 対象外＝#389 の履歴グループは付けない（付けても無意味）。
  // クリップ調整を Undo 可能にするのは履歴 slice/保存先の見直しが要るため別 Issue（#472）で扱う。
  return (
    <div className="card-tight" style={{ background: "var(--color-surface-alt)", marginTop: 6 }}>
      <p className="text-sm text-muted" style={{ margin: "0 0 6px" }}>
        ▶ 動画素材です。仕上がり確認では、再生すると動画が流れます（停止中は表示されません）。書き出しにも動画が入ります。
        {dur != null && `（長さ：約${formatDuration(dur)}）`}
      </p>

      {/* 枠への収め方 */}
      <div className="field" style={{ marginBottom: 6 }}>
        <label className="field-label text-sm" style={{ margin: "0 0 2px" }}>
          枠への収め方
        </label>
        <FitSelect value={clip?.fit ?? DEFAULT_FIT} onChange={(fit) => { if (fit) patchClip({ fit }); }} />
      </div>

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

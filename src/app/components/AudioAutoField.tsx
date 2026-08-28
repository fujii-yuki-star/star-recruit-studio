// 音の自動処理（#257 ダッキング／#259 ノーマライズ・ADR-0032 追補4）の設定欄。
//
// ⚠️ **技術用語を出さない**（§2-3）＝「ダッキング」「ノーマライズ」「LUFS」「サイドチェイン」は書かない。
// 「セリフ中はBGMを控えめにする」「全体の音量をそろえる」と、やることそのものを書く。
// ⚠️ **設定はプロジェクト単位**（`videoSettings.audioAuto`）＝場面ごとには持たない（追補4）。
import { useProjectStore } from "../store/projectStore";
import {
  DUCK_DEPTH_MAX,
  DUCK_DEPTH_MIN,
  DUCK_TIME_MAX,
  DUCK_TIME_MIN,
  resolveAudioAuto,
  type AudioAutoSettings,
} from "../../domain/voice/audioAuto";

/** 下げ幅の選択肢（%は出さず、聞こえ方の言葉にする）。 */
const DEPTH_CHOICES: { label: string; value: number }[] = [
  { label: "少しだけ", value: 0.3 },
  { label: "ふつう", value: 0.6 },
  { label: "しっかり", value: 0.85 },
];

/** 変わり方の速さ（秒は出さない）。下がるまで／戻るまでをまとめて選ぶ。 */
const SPEED_CHOICES: { label: string; attack: number; release: number }[] = [
  { label: "ゆっくり", attack: 0.5, release: 1.2 },
  { label: "ふつう", attack: 0.25, release: 0.6 },
  { label: "すばやく", attack: 0.08, release: 0.2 },
];

/** いまの設定にいちばん近い選択肢（手で書いた値・別の版の値でも「どれでもない」にしない）。 */
function nearest<T>(items: readonly T[], value: number, of: (t: T) => number): T {
  return items.reduce((best, t) => (Math.abs(of(t) - value) < Math.abs(of(best) - value) ? t : best), items[0]);
}

export function AudioAutoField({ disabled }: { disabled?: boolean }) {
  const audioAuto = useProjectStore((s) => s.meta.videoSettings.audioAuto);
  const updateAudioAuto = useProjectStore((s) => s.updateAudioAuto);
  const v = resolveAudioAuto(audioAuto);

  const patch = (next: AudioAutoSettings): void => updateAudioAuto(next);

  const depth = nearest(DEPTH_CHOICES, v.duckDepth, (c) => c.value);
  const speed = nearest(SPEED_CHOICES, v.duckAttackSec, (c) => c.attack);

  return (
    <div className="field">
      <span className="field-label">音の自動調整</span>
      {/* ⚠️ **仕上がり確認では効かないことを言う**（α-6 出口監査 [プ]・§2-5）＝同じ画面の字幕の欄は
          「仕上がり確認でも同じ設定で表示されます」と**明記している**のに、音だけ何も言っていなかった。
          #257/#259 は ADR-0032 追補4 で「書き出し時の処理」と決めたので、確認の再生には出ない。
          ⚠️ **実装を確認にも効かせる**のは追補4 に反するので採らない（言葉で揃える）。 */}
      <p className="field-hint">
        ここでの調整は<strong>保存した動画にだけ</strong>入ります。仕上がり確認の再生では、調整前の音のまま鳴ります。
      </p>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={v.duckBgm}
          disabled={disabled}
          onChange={(e) => patch({ duckBgm: e.target.checked })}
        />
        <span>セリフが流れている間はBGMを控えめにする</span>
      </label>
      <p className="field-hint">セリフが聞き取りやすくなります。セリフが無いところでは元の大きさに戻ります。</p>

      {v.duckBgm && (
        <div style={{ display: "flex", gap: "var(--gap-md)", flexWrap: "wrap" }}>
          <label className="field">
            <span className="field-label">どのくらい控えめにするか</span>
            <select
              className="input"
              value={depth.label}
              disabled={disabled}
              onChange={(e) => {
                const c = DEPTH_CHOICES.find((x) => x.label === e.target.value);
                if (c) patch({ duckDepth: Math.min(Math.max(c.value, DUCK_DEPTH_MIN), DUCK_DEPTH_MAX) });
              }}
            >
              {DEPTH_CHOICES.map((c) => (
                <option key={c.label} value={c.label}>{c.label}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">変わり方</span>
            <select
              className="input"
              value={speed.label}
              disabled={disabled}
              onChange={(e) => {
                const c = SPEED_CHOICES.find((x) => x.label === e.target.value);
                if (c) {
                  patch({
                    duckAttackSec: Math.min(Math.max(c.attack, DUCK_TIME_MIN), DUCK_TIME_MAX),
                    duckReleaseSec: Math.min(Math.max(c.release, DUCK_TIME_MIN), DUCK_TIME_MAX),
                  });
                }
              }}
            >
              {SPEED_CHOICES.map((c) => (
                <option key={c.label} value={c.label}>{c.label}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={v.normalize}
          disabled={disabled}
          onChange={(e) => patch({ normalize: e.target.checked })}
        />
        <span>全体の音量をそろえる</span>
      </label>
      <p className="field-hint">
        素材ごとの音量差をならし、大きすぎて音が割れないように整えます。動画サイトで再生したときの大きさに近づきます。
      </p>
    </div>
  );
}

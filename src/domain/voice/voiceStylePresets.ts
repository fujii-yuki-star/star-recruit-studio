// ウィザード「読み上げの声」の感じ（落ち着いた/明るい/やわらかい）→ voiceSettings の speed/pitch/intonation。
// 設定画面の詳細スライダー（voiceParams）の簡易プリセット版。値はいずれも各 ParamRange（schemas VoiceSettings §7.1）内。
// VOICEVOX 話者（speaker＝声のスタイル）は別概念でアプリ設定側にあり、ここでは触れない。
import type { VoiceSettings } from '../project/types';

/** プリセットが設定する声パラメータ（speed/pitch/intonation のみ。defaultVoiceId/volume は据え置き）。 */
export type VoiceStyleParams = Pick<VoiceSettings, 'speed' | 'pitch' | 'intonation'>;

export interface VoiceStylePreset {
  /** UI 選択肢の id（ウィザード内で使う識別子）。 */
  id: string;
  /** 画面表示名・説明。 */
  label: string;
  desc: string;
  params: VoiceStyleParams;
}

/** 既定（min 1.0 / def 0.0 / def 1.0）からの控えめな差分。声の感じを分かる程度に変える。 */
export const VOICE_STYLE_PRESETS: VoiceStylePreset[] = [
  { id: 'calm', label: '落ち着いた声', desc: '丁寧で安心感のある話し方', params: { speed: 0.95, pitch: -0.05, intonation: 0.95 } },
  { id: 'bright', label: '明るい声', desc: '元気で親しみやすい話し方', params: { speed: 1.1, pitch: 0.1, intonation: 1.2 } },
  { id: 'soft', label: 'やわらかい声', desc: 'やさしくゆったりした話し方', params: { speed: 0.9, pitch: 0.0, intonation: 0.85 } },
];

/** id からプリセットのパラメータを返す（未知 id は先頭＝既定プリセット）。 */
export function voiceStyleParams(id: string): VoiceStyleParams {
  return (VOICE_STYLE_PRESETS.find((p) => p.id === id) ?? VOICE_STYLE_PRESETS[0]).params;
}

/**
 * 現在の voiceSettings に完全一致するプリセット id を返す（無ければ先頭＝既定）。
 * ウィザード再表示時の初期選択に使う（ウィザードで設定した値はプリセットに一致して復元できる）。
 */
export function matchVoiceStyleId(v: VoiceStyleParams | undefined): string {
  const found = VOICE_STYLE_PRESETS.find(
    (p) =>
      v != null &&
      v.speed === p.params.speed &&
      v.pitch === p.params.pitch &&
      v.intonation === p.params.intonation,
  );
  return (found ?? VOICE_STYLE_PRESETS[0]).id;
}

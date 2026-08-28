// VOICEVOX ローカルエンジンで音声合成する VoiceProvider 実装（Tauri コマンド越し）。
// Rust 側（voicevox.rs）が接続先（設定 or 既定 localhost:50021）に HTTP 接続する。
// ブラウザ開発では使わず Mock にフォールバック（store で選択）。
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_VOICE_ID } from '../../domain/constants';
import { getVoicevoxSpeaker, getVoicevoxUrl } from '../appSettings';
import type { SynthesizeInput, SynthesizedVoice, VoiceProvider } from '../../domain/voice/voiceProvider';
import { wavDurationSec } from '../../domain/voice/wavDuration';
import { DEFAULT_SPEAKER } from '../../domain/voice/voiceCatalog';
import { MockVoiceProvider } from './mockVoiceProvider';
import { ensureReadingDictSynced } from './readingDictSync';

// 本アプリの voiceId → VOICEVOX の speaker(スタイル)番号。既定話者は voiceCatalog の単一参照元（§2-7）。
// 選べる話者一覧（UI向け）も domain/voice/voiceCatalog.ts に置く（infra→domain は §4 で許可・app も domain を参照）。
const SPEAKER_BY_VOICE_ID: Record<string, number> = {
  [DEFAULT_VOICE_ID]: DEFAULT_SPEAKER,
};

/** 使用する speaker を解決：設定の話者 → voiceId マップ → 既定（純粋・テスト可能）。 */
export function resolveSpeaker(settingSpeaker: number | null, voiceId: string): number {
  return settingSpeaker ?? SPEAKER_BY_VOICE_ID[voiceId] ?? DEFAULT_SPEAKER;
}

/** 合成に使う speaker：行の明示話者（input.speaker）を最優先し、無ければ 設定→voiceId→既定（ADR-0015・純粋）。 */
export function effectiveSpeaker(
  input: Pick<SynthesizeInput, 'speaker' | 'voiceId'>,
  settingSpeaker: number | null,
): number {
  return input.speaker ?? resolveSpeaker(settingSpeaker, input.voiceId);
}

export class VoicevoxProvider implements VoiceProvider {
  async synthesize(input: SynthesizeInput): Promise<SynthesizedVoice> {
    // ⚠️ **声を作る直前に読み方辞書をそろえる**（ADR-0037 決定2・決定7）＝合成の入口は4か所あるので、
    // ここ1か所で通す（書き出し前に同梱フォントをそろえる `loadExportFonts` と同じ形）。
    // 反映できなければ**投げる**＝誤読のまま成功にしない（§2-5）。
    await ensureReadingDictSynced();
    const speaker = effectiveSpeaker(input, getVoicevoxSpeaker());
    const baseUrl = getVoicevoxUrl();
    const audioDataUrl = await invoke<string>('synthesize_voice', {
      text: input.text,
      speaker,
      speed: input.speed,
      pitch: input.pitch,
      intonation: input.intonation,
      // 空なら Rust 側が環境変数→既定にフォールバックする。
      baseUrl: baseUrl || null,
    });
    // 尺は**実 WAV から測る**（wavDurationSec）。文字数概算だと本番エンジンの実尺とズレる（#547 P3-3）。
    // 仕上がり確認/書き出しの尺解決（lineDurationsFromAudio）と同じ導出＝将来 durationSec を使っても一致。
    // 解析不能（不正 WAV）は 0＝呼び出し側で自動逐次フォールバック（lineDurationsFromAudio と同じ扱い）。
    return { audioDataUrl, durationSec: wavDurationSec(audioDataUrl) };
  }
}

/**
 * 読み（カタカナ）を**指定した下がり方**で鳴らす（読み方の聞き比べ・ADR-0037 決定6・#350）。
 *
 * ⚠️ **辞書に触らない**＝登録する前に確かめるための機能なので、`ensureReadingDictSynced` も通さない
 *（まだ入れていない語を聞くのだから、そろえる意味が無い＝そろえられないエンジンでも聞き比べはできる）。
 */
export async function synthesizeWithAccent(
  yomi: string,
  accentType: number,
  v: { speed: number; pitch: number; intonation: number; speaker?: number; voiceId: string },
): Promise<string> {
  if (!isTauri()) return new MockVoiceProvider().synthesize({ text: yomi, ...v }).then((r) => r.audioDataUrl);
  return invoke<string>('voicevox_synthesize_with_accent', {
    yomi,
    accentType,
    speaker: effectiveSpeaker(v, getVoicevoxSpeaker()),
    speed: v.speed,
    pitch: v.pitch,
    intonation: v.intonation,
    baseUrl: getVoicevoxUrl() || null,
  });
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

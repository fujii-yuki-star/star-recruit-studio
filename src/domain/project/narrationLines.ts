// 掛け合い：場面のセリフ列（scene.lines）の一元アクセサ＋意味検証（ADR-0015・#180）。純粋関数（副作用なし）。
// 全消費側（store/描画/書き出し/プレビュー/台本/precheck）は scene.narration を直接見ず sceneLines を通す。
// scene.lines があればそれを、無ければ単一 narration を1行に写して返す＝旧データ（lines 不在）も同一に扱える。
import { characterForSpeaker } from '../voice/voiceCatalog';
import type { Narration, NarrationLine, Scene, Warning } from './types';

/**
 * 単一 narration を1行（line_001）に写す（後方互換・lines 不在時の実効行）。
 * 旧 narration.voiceId（文字列）は speaker（数値）へ逆変換しない（ADR-0015）＝speaker 未指定＝既定声を継承。
 * narration.intonation は NarrationLine に持たないため写さない（行に固有値を持たせず project 既定 voiceSettings.intonation を継承する設計・ADR-0015）。
 */
export function lineFromNarration(narration: Narration): NarrationLine {
  return {
    lineId: 'line_001',
    text: narration.text,
    speed: narration.speed ?? null,
    pitch: narration.pitch ?? null,
    voicePath: narration.voicePath ?? null,
    status: narration.status,
  };
}

/** 場面の実効セリフ列。scene.lines があればそれ、無ければ単一 narration を1行とみなす（ADR-0015）。 */
export function sceneLines(scene: Scene): NarrationLine[] {
  return scene.lines && scene.lines.length > 0 ? scene.lines : [lineFromNarration(scene.narration)];
}

function warn(code: string, message: string, field: string, severity: Warning['severity']): Warning {
  return { code, message, field, severity, autoFixed: false };
}

/**
 * 掛け合いのセリフ列（scene.lines）の意味検証（11 §8 V16–V19・ADR-0015）。純粋関数で Warning[] を返す。
 * スキーマ適合（型/必須/enum/範囲＝V2）は ajv 済み前提。ここは相互参照・順序・実在などの意味検証のみ。
 * 対象は明示 lines のみ（単一 narration の場面は対象外＝sceneLines が1行へ解決）。文言は §2-3/§2-5。
 * - V16: lineId が scene 内一意 / V17: startSec が [0, durationSec] / V18: startSec 昇順 / V19: speaker が voiceCatalog 実在。
 */
export function validateSceneLines(lines: NarrationLine[] | undefined, durationSec: number): Warning[] {
  if (!lines || lines.length === 0) return [];
  const warnings: Warning[] = [];
  const seen = new Set<string>();
  let prevStart = -Infinity;
  for (const line of lines) {
    const field = `lines.${line.lineId}`;
    // V16: lineId が scene 内一意。
    if (seen.has(line.lineId)) {
      warnings.push(warn('LINE_ID_DUPLICATE', 'セリフの並びに重複があります。自動で振り直します', field, 'warning'));
    }
    seen.add(line.lineId);
    // V19: speaker が voiceCatalog に実在（null/未指定＝継承は可）。
    if (line.speaker != null && characterForSpeaker(line.speaker) == null) {
      warnings.push(warn('LINE_SPEAKER_UNKNOWN', '選べない声が指定されています。標準の声を使います', field, 'warning'));
    }
    // startSec は任意（未指定＝自動逐次）。指定時のみ範囲・順序を検証する。
    if (line.startSec != null) {
      // V17: [0, durationSec] に収まる。
      if (line.startSec < 0 || line.startSec > durationSec) {
        warnings.push(warn('LINE_START_OUT_OF_RANGE', 'セリフの開始位置が場面の長さを超えています。範囲内に収めます', field, 'warning'));
      }
      // V18: 直前に startSec を持つ行と同時刻以前に始まらない（昇順・時間重複なし＝11 §8 / ADR-0015）。
      if (line.startSec <= prevStart) {
        warnings.push(warn('LINE_ORDER_INVALID', 'セリフの開始順序が前後しています。時間順に並べ直せます', field, 'warning'));
      }
      prevStart = line.startSec;
    }
  }
  return warnings;
}

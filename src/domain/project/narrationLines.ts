// 掛け合い：場面のセリフ列（scene.lines）の一元アクセサ（ADR-0015・#180）。純粋関数（副作用なし）。
// 全消費側（store/描画/書き出し/プレビュー/台本/precheck）は scene.narration を直接見ず本関数を通す。
// scene.lines があればそれを、無ければ単一 narration を1行に写して返す＝旧データ（lines 不在）も同一に扱える。
import type { Narration, NarrationLine, Scene } from './types';

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

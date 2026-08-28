// 掛け合い：場面のセリフ列（scene.lines）の一元アクセサ＋意味検証（ADR-0015・#180）。純粋関数（副作用なし）。
// 全消費側（store/描画/書き出し/プレビュー/台本/precheck）は scene.narration を直接見ず sceneLines を通す。
// scene.lines があればそれを、無ければ単一 narration を1行に写して返す＝旧データ（lines 不在）も同一に扱える。
import { NARRATION_STATUS, type NarrationStatus } from '../enums';
import { characterForSpeaker } from '../voice/voiceCatalog';
import { wavDurationSec } from '../voice/wavDuration';
import type { Narration, NarrationLine, Scene, Warning } from './types';

/**
 * 単一 narration を1行（line_001）に写す（後方互換・lines 不在時の実効行）。
 * 旧 narration.voiceId（文字列）は speaker（数値）へ逆変換しない（ADR-0015）＝speaker 未指定＝既定声を継承。
 * speed/pitch/intonation は写す（#242 で NarrationLine に intonation を追加・null=場面/動画の既定を継承）。
 */
export function lineFromNarration(narration: Narration): NarrationLine {
  return {
    lineId: 'line_001',
    text: narration.text,
    speed: narration.speed ?? null,
    pitch: narration.pitch ?? null,
    intonation: narration.intonation ?? null,
    voicePath: narration.voicePath ?? null,
    status: narration.status,
  };
}

/** 場面の実効セリフ列。scene.lines があればそれ、無ければ単一 narration を1行とみなす（ADR-0015）。 */
export function sceneLines(scene: Scene): NarrationLine[] {
  return scene.lines && scene.lines.length > 0 ? scene.lines : [lineFromNarration(scene.narration)];
}

/**
 * 同時開始（ADR-0031）の不変条件を保つ正規化（純粋・冪等）。読込・行の削除/移動・場面分割で呼ぶ＝
 * 「設定できるのに効かない状態」を残さない（ADR-0026④）。
 * ① 先頭行は「前と同時」にできない＝`startWithPrevious` を落とす（並べ替え/削除で先頭になった休眠フラグの復活を防ぐ）。
 * ② `startWithPrevious` の行は `startSec` を持たない（実装が無視＝正典 11 §8。schema は併存を許すが読込で解消）。
 * 違反が無ければ同一参照を返す（未保存/履歴にしない）。単一 narration（lines 不在）は対象外。
 */
export function normalizeDialogueTiming(scene: Scene): Scene {
  if (!scene.lines || scene.lines.length === 0) return scene;
  let changed = false;
  const lines = scene.lines.map((l, i) => {
    let next = l;
    if (i === 0 && l.startWithPrevious === true) {
      next = { ...next };
      delete next.startWithPrevious; // 先頭は同時にする相手がいない
    }
    if (next.startWithPrevious === true && next.startSec != null) {
      if (next === l) next = { ...next };
      delete next.startSec; // 同時開始は開始秒を保存しない（ADR-0031）
    }
    if (next !== l) changed = true;
    return next;
  });
  return changed ? { ...scene, lines } : scene;
}

/**
 * この場面に「まだ声が作られていない実効行」があるか（掛け合い・単一 narration 共通・ADR-0015）。
 * 本文（trim 非空）のある行が1つでも未生成（status!==generated）なら true。本文が無い行は対象外（読む物が無い）。
 * `generateAllNarrations`（一括生成の対象判定）と precheck の「読み上げの声」チェックがこの単一判定を共有する
 * ＝掛け合いでも「声を作成」→precheck が同じ実効状態を見る（#403・同概念同挙動）。scene.narration.status は直接見ない。
 */
export function sceneNeedsVoice(scene: Scene): boolean {
  return sceneLines(scene).some((l) => l.text.trim().length > 0 && l.status !== NARRATION_STATUS.generated);
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
    // V16: lineId が scene 内一意。UI 採番は一意のため通常は出ない（破損データ向けの案内）。
    if (seen.has(line.lineId)) {
      warnings.push(warn('LINE_ID_DUPLICATE', 'セリフの並びに重複があります。作り直してください', field, 'warning'));
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
        warnings.push(warn('LINE_START_OUT_OF_RANGE', 'セリフの開始位置が場面の長さを超えています。場面の長さ内にしてください', field, 'warning'));
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

// ── 行ごと音声（ストア/保存）の補助（ADR-0015 PR-C2）。純粋関数。 ──

/** 行音声マップ（narrationAudioById）のメモリ内キー。scene×line で一意。 */
export function lineAudioKey(sceneId: string, lineId: string): string {
  return `${sceneId}/${lineId}`;
}

/** 行音声ファイルの保存名 stem（import_voice は sceneId を不透明な stem 扱い＝voices/<stem>.wav）。 */
export function lineVoiceStem(sceneId: string, lineId: string): string {
  return `${sceneId}_${lineId}`;
}

/**
 * その行の音声キー（`narrationAudioById` のキー）。**掛け合いは行ごと・単独は場面 id**。
 *
 * ⚠️ **この分岐を呼ぶ側に書かせない**（§2-7・PR #896 レビュー ℹ️）＝同じ規則が
 * `liveNarrationAudioKeys`・`lineDurationsFromAudio`・書き出しの3か所に写っており、
 * **単独読み上げだけ引けない**（`sceneId_line_001` を引いてしまう）事故が起きた。
 * 単独読み上げの `lineId` は `sceneLines` が作る `line_001` だが、**保存されているキーは場面 id**。
 */
export function narrationAudioKey(scene: Scene, lineId: string): string {
  return scene.lines && scene.lines.length > 0 ? lineAudioKey(scene.sceneId, lineId) : scene.sceneId;
}

/**
 * 生存しているナレーション音声キー（narrationAudioById のキー）の集合（#390・メモリ効率）。
 * 掛け合い場面は行ごと（lineAudioKey）、単一 narration 場面は sceneId。掛け合い⇄単一の切替や場面/行の削除で
 * 孤児になった音声キャッシュ（narrationAudioById／dirty セット）を剪定するのに使う（保存時・削除時）。
 */
export function liveNarrationAudioKeys(scenes: Scene[]): Set<string> {
  const keys = new Set<string>();
  for (const sc of scenes) {
    // 規則は `narrationAudioKey` に1つ（写すと片方だけ直る）。
    for (const l of sceneLines(sc)) keys.add(narrationAudioKey(sc, l.lineId));
  }
  return keys;
}

/**
 * 掛け合いの各行の音声長（lineId→秒）を、メモリ上の音声（narrationAudioById）から求める（#392・タイムライン表示）。
 * compileTimeline の lineDurationsFor に渡すと、自動逐次（startSec 未指定）の掛け合いが各行の実音声長で区間表示される
 * （未指定だと cursor が進まず最終行だけ全幅になる）。単一 narration（明示 lines 無し）は実効1行＝常に全幅ゆえ空でよい。
 *
 * **status===generated の行のみ**を対象にする（#392 レビュー）：本文/話し方を編集した行は updateLine で status=none へ戻るが、
 * Undo 安全のためメモリ上の旧 WAV キャッシュは同じ行キーに残る（#390）。status を見ないと未生成の新本文へ旧尺を適用してしまう。
 * voicePath の有無では判定しない（生成済みだが未保存＝voicePath 無しでも実音声長で表示できる）。解析 0（不正/空）も除外＝自動逐次へ。
 * WAV ヘッダ解析（wavDurationSec）は同期。
 */
export function lineDurationsFromAudio(scene: Scene, audioById: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  if (scene.lines && scene.lines.length > 0) {
    for (const line of scene.lines) {
      if (line.status !== NARRATION_STATUS.generated) continue; // 編集で none に戻った行は旧キャッシュの尺を使わない
      const audio = audioById[lineAudioKey(scene.sceneId, line.lineId)];
      if (!audio) continue;
      const d = wavDurationSec(audio);
      if (d > 0) out[line.lineId] = d; // 0（不正/空）は自動逐次フォールバック
    }
  }
  return out;
}

/** 指定行の status を更新した Scene（明示 lines があれば該当行・無ければ単一 narration を更新）。 */
export function withLineStatus(scene: Scene, lineId: string, status: NarrationStatus): Scene {
  if (scene.lines && scene.lines.length > 0) {
    return { ...scene, lines: scene.lines.map((l) => (l.lineId === lineId ? { ...l, status } : l)) };
  }
  return { ...scene, narration: { ...scene.narration, status } };
}

/** 指定行の voicePath を更新した Scene（明示 lines があれば該当行・無ければ単一 narration を更新）。 */
export function withLineVoicePath(scene: Scene, lineId: string, voicePath: string | null): Scene {
  if (scene.lines && scene.lines.length > 0) {
    return { ...scene, lines: scene.lines.map((l) => (l.lineId === lineId ? { ...l, voicePath } : l)) };
  }
  return { ...scene, narration: { ...scene.narration, voicePath } };
}

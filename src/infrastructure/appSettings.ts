// アプリ全体の設定（プロジェクト非依存）。VOICEVOX 接続先・ナレーター話者・欄の配置など。localStorage に保持。
import { parsePanelLayout } from '../domain/layout/panelLayout';
import type { PanelLayout, PanelScreenId } from '../domain/layout/panelLayout';
// project.json には入れない（接続先は環境差があり、共有プロジェクトに含めるべきでないため）。
// Tauri WebView でも localStorage は永続する（projectFs と同様）。
const VOICEVOX_URL_KEY = 'app.voicevoxUrl';
const VOICEVOX_SPEAKER_KEY = 'app.voicevoxSpeaker';
const AI_MODEL_KEY = 'app.aiModel';
const PANEL_LAYOUT_KEY = 'app.panelLayout';

/** 動画案生成に使う Gemini モデルID（現行の無料枠で使える既定）。設定で変更可＝ADR-0010 未解決#1。 */
export const DEFAULT_AI_MODEL = 'gemini-2.5-flash';

function read(key: string): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
}
function write(key: string, value: string): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
}

/** VOICEVOX 接続先URL。未設定なら ''（Rust 側が既定 http://localhost:50021 を使う）。 */
export function getVoicevoxUrl(): string {
  return read(VOICEVOX_URL_KEY) ?? '';
}
export function setVoicevoxUrl(url: string): void {
  write(VOICEVOX_URL_KEY, url.trim());
}

/** ナレーター話者（VOICEVOX の speaker/スタイル番号）。未設定なら null（プロバイダ既定にフォールバック）。 */
export function getVoicevoxSpeaker(): number | null {
  const raw = read(VOICEVOX_SPEAKER_KEY);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
export function setVoicevoxSpeaker(speaker: number): void {
  write(VOICEVOX_SPEAKER_KEY, String(speaker));
}

/** 使用する Gemini モデルID。未設定なら既定（DEFAULT_AI_MODEL）。 */
export function getAiModel(): string {
  const v = read(AI_MODEL_KEY);
  return v && v.trim() ? v.trim() : DEFAULT_AI_MODEL;
}
export function setAiModel(model: string): void {
  write(AI_MODEL_KEY, model.trim());
}

/**
 * 編集画面の欄の配置（ADR-0033 決定4/5）。**画面ごとに1つ**＝タイムライン編集と場面編集は別に覚える
 * （置いてある欄の顔ぶれが違うため）。**動画ごとには持たない**＝どの動画を開いても同じ配置。
 * **プロジェクトの JSON には入れない**（画面の見た目の好みは動画の中身ではない）。
 *
 * 読めない・壊れているときは `null`（＝呼び出し側が既定を使う）＝**設定のせいで画面が開けない**を作らない。
 * 整合（知らない欄を落とす・割合をそろえる）は domain（`normalizeLayout`）が行うので、ここは入れ物だけ。
 */
export function getPanelLayout(screenId: PanelScreenId): PanelLayout | null {
  const raw = read(`${PANEL_LAYOUT_KEY}.${screenId}`);
  if (!raw) return null;
  try {
    // **形の検査は domain（`parsePanelLayout`）に任せる**＝JSON として読めても中身が壊れていることがある
    // （手で編集した・別の版が書いた）。戻り型を `PanelLayout` にしておくと、使う側が `as` で押し込めない。
    return parsePanelLayout(JSON.parse(raw));
  } catch {
    return null; // 壊れた値は「無い」と同じ扱い＝既定へ落ちる
  }
}

export function setPanelLayout(screenId: PanelScreenId, layout: PanelLayout): void {
  try {
    write(`${PANEL_LAYOUT_KEY}.${screenId}`, JSON.stringify(layout));
  } catch {
    // 保存できなくても**その場の操作は続ける**（境界のドラッグごとに走るので、投げると掴んだまま画面が固まる）。
    // 次に開いたときに既定へ戻るだけ＝作りかけの動画は失わない。**いまは無言**で、見せ方は段階3 で決める
    // （ADR-0033 未解決6）。
  }
}

/** 「配置を既定に戻す」＝保存を消す（次に開くと既定が使われる・決定6）。 */
export function clearPanelLayout(screenId: PanelScreenId): void {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(`${PANEL_LAYOUT_KEY}.${screenId}`);
}

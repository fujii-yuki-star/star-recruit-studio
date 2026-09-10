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

/** 画面の見た目（ADR-0039・#1108）。`system` ＝ OS の設定に合わせる。 */
export type Appearance = 'system' | 'light' | 'dark';

/** 覚えの置き場。⚠️ **気軽に変えない**＝変えると利用者の記憶が消える。 */
const APPEARANCE_KEY = 'app.appearance';

/**
 * 覚えが無いときの見た目。
 *
 * ⚠️ **ここ1つで既定を変えられる**（ADR-0039 決定3）。「明るいまま」にするなら `'light'` にするだけでよい。
 * ⚠️ **ADR の状態をここに書き写さない**（レビュー由来 🔴・2026-09-10）＝以前はここに
 * 当時の状態と「利用者確認待ち」を書いており、状態が動いた瞬間に**嘘になった**。
 * 状態を持つのは **ADR 本文と `adr/README.md` の2点だけ**（`CLAUDE.md §11`）。
 */
export const APPEARANCE_DEFAULT: Appearance = 'system';

/** 見た目の好み。⚠️ **知らない値は既定へ倒す**（ADR-0033 結果・影響＝起動できない状態を作らない）。 */
export function getAppearance(): Appearance {
  try {
    const v = read(APPEARANCE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : APPEARANCE_DEFAULT;
  } catch {
    return APPEARANCE_DEFAULT;
  }
}

export function setAppearance(value: Appearance): void {
  try {
    write(APPEARANCE_KEY, value);
  } catch {
    // 覚えられなくても、その場では効かせる（呼び出し側が正を持つ）。
  }
}

/**
 * 「はい／いいえ」の画面の好み（#1103）。
 *
 * ⚠️ **読み書きはここに置く**（`CLAUDE.md §4`＝外部I/O は `infrastructure` に隔離する）＝
 * `localStorage` を画面や hook から直に触ると、**同じことを何通りにも持つ**ことになる
 * （ADR-0033 段階4「同じことを2通りで持たない」）。React 側の糊（この場の正・他の使い手への合図）は
 * `app/hooks/booleanPref.ts` が持つ。
 *
 * ⚠️ **壊れた値・読めないときは既定へ倒す**（ADR-0033 結果・影響＝起動できない状態を作らない）。
 * `getPanelLayout` が壊れた値を「無い」と同じ扱いにしているのと同じ流儀。
 * ⚠️ **`"1"`/`"0"` 以外を「いいえ」に倒さない**＝既定が「はい」の好みで、壊れた値のときだけ
 * 黙って「いいえ」になる（＝**既定が効かない**）。
 */
export function getBooleanSetting(key: string, fallback: boolean): boolean {
  try {
    const v = read(key);
    if (v === '1') return true;
    if (v === '0') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

export function setBooleanSetting(key: string, value: boolean): void {
  try {
    write(key, value ? '1' : '0');
  } catch {
    // 覚えられなくても、その場では効かせる（呼び出し側が正を持つ）。
  }
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

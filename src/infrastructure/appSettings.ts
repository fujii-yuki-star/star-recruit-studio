// アプリ全体の設定（プロジェクト非依存）。VOICEVOX 接続先・ナレーター話者など。localStorage に保持。
// project.json には入れない（接続先は環境差があり、共有プロジェクトに含めるべきでないため）。
// Tauri WebView でも localStorage は永続する（projectFs と同様）。
const VOICEVOX_URL_KEY = 'app.voicevoxUrl';
const VOICEVOX_SPEAKER_KEY = 'app.voicevoxSpeaker';

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

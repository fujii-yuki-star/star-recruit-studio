// 字幕ファイル（SRT / WebVTT）の読み書き（ADR-0055・#1351）。純粋関数（副作用なし・§7 テスト対象）。
//
// ⚠️ **時刻と文字だけ**を交換する＝体裁（色・位置・ASS のスタイル）は捨てる／書かない（ADR-0055 決定1）。
// ⚠️ **読めない所は黙って捨てない**＝読めなかった塊の数を返す（呼ぶ側が「◯件は読めませんでした」と言う・§2-5）。

/** 字幕1つぶん（秒）。 */
export interface SubtitleCue {
  startSec: number;
  endSec: number;
  text: string;
}

export const SUBTITLE_FILE_KIND = { srt: 'srt', vtt: 'vtt' } as const;
export type SubtitleFileKind = (typeof SUBTITLE_FILE_KIND)[keyof typeof SUBTITLE_FILE_KIND];

/**
 * ファイルの中身（バイト列）を文字にする（ADR-0055 決定2）。
 * UTF-8（BOM あり・なし）→ UTF-16（BOM あり）→ **読めなければ Shift_JIS**（日本の古い字幕ファイル）。どれでもなければ null。
 */
export function decodeSubtitleBytes(bytes: Uint8Array): string | null {
  const strict = (label: string): string | null => {
    try {
      return new TextDecoder(label, { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  };
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return strict('utf-16le');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return strict('utf-16be');
  const utf8 = strict('utf-8');
  // BOM は TextDecoder が落とす（ignoreBOM の既定＝false）＝ここで消し直さない（変異チェックで等価と分かった）。
  if (utf8 != null) return utf8;
  return strict('shift_jis');
}

/** `00:01:02,345`／`01:02.345`／`1:02:03.4` を秒へ。読めなければ null。 */
export function parseSubtitleTime(s: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s.trim());
  if (!m) return null;
  const h = m[1] != null ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (min >= 60 || sec >= 60) return null;
  const frac = m[4] != null ? Number(m[4].padEnd(3, '0')) / 1000 : 0;
  return h * 3600 + min * 60 + sec + frac;
}

/** 体裁の印を落とす（`<i>`・`<c.red>`・`{\an8}` など）。⚠️ 文字そのものの `<`（「1<2」など）は落とさない＝タグの形だけ。 */
function stripMarkup(line: string): string {
  return line
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/<\d{1,2}:\d{2}[:.\d]*>/g, '') // VTT のカラオケの時刻印
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trimEnd();
}

/**
 * 字幕ファイルの文字を読む（SRT と WebVTT のどちらも＝先頭の `WEBVTT` で見分けない・時刻の行で読む）。
 *
 * - 塊（空行で区切る）ごとに、`開始 --> 終わり` の行を探し、その後ろの行を文とする。番号の行・VTT のキューの名前は捨てる。
 * - `WEBVTT`・`NOTE`・`STYLE`・`REGION` の塊は字幕ではないので数えない。
 * - 時刻が読めない・終わりが始まり以前・文が空の塊は**読めなかった数**に入れる（黙って捨てない）。
 * - 時刻順に並べる（ファイルの並びが前後していても）。
 */
export function parseSubtitleFile(text: string): { cues: SubtitleCue[]; unreadable: number } {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/);
  const cues: SubtitleCue[] = [];
  let unreadable = 0;
  for (const raw of blocks) {
    const lines = raw.split('\n').filter((l, i, a) => !(l.trim() === '' && (i === 0 || i === a.length - 1)));
    if (lines.length === 0 || lines.every((l) => l.trim() === '')) continue;
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(lines[0].trim())) continue;
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0) { unreadable += 1; continue; }
    const [a, b] = lines[at].split('-->');
    const start = parseSubtitleTime(a);
    // VTT はキューの設定（`align:start` 等）が時刻の後ろに続く＝最初の語だけを時刻として読む。
    const end = parseSubtitleTime((b ?? '').trim().split(/\s+/)[0] ?? '');
    const body = lines.slice(at + 1).map(stripMarkup).filter((l) => l.trim() !== '').join('\n');
    if (start == null || end == null || end <= start || body === '') { unreadable += 1; continue; }
    cues.push({ startSec: start, endSec: end, text: body });
  }
  cues.sort((x, y) => x.startSec - y.startSec || x.endSec - y.endSec);
  return { cues, unreadable };
}

/** 秒を `HH:MM:SS,mmm`（SRT）／`HH:MM:SS.mmm`（VTT）へ。ミリ秒で丸める。 */
export function formatSubtitleTime(sec: number, kind: SubtitleFileKind): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const f = ms % 1000;
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}${kind === SUBTITLE_FILE_KIND.srt ? ',' : '.'}${pad(f, 3)}`;
}

/**
 * 字幕ファイルの文字を組み立てる（ADR-0055 決定2＝SRT は BOM 付き・VTT は BOM なし）。
 * ⚠️ 空行は塊の区切りなので、文の中の空行は詰める（読み直したときに塊が割れない）。
 */
export function formatSubtitleFile(cues: readonly SubtitleCue[], kind: SubtitleFileKind): string {
  const body = (t: string): string => t.split(/\r?\n/).filter((l) => l.trim() !== '').join('\n');
  const parts = cues
    .filter((c) => c.endSec > c.startSec && body(c.text) !== '')
    .map((c, i) => {
      const range = `${formatSubtitleTime(c.startSec, kind)} --> ${formatSubtitleTime(c.endSec, kind)}`;
      return kind === SUBTITLE_FILE_KIND.srt ? `${i + 1}\n${range}\n${body(c.text)}` : `${range}\n${body(c.text)}`;
    });
  return kind === SUBTITLE_FILE_KIND.srt
    ? `${String.fromCharCode(0xfeff)}${parts.join('\n\n')}\n`
    : `WEBVTT\n\n${parts.join('\n\n')}\n`;
}

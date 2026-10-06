// 字幕ファイル（SRT / WebVTT）の読み書き（ADR-0055・#1351）。純粋関数（副作用なし・§7 テスト対象）。
//
// ⚠️ **時刻と文字だけ**を交換する＝体裁（色・位置・ASS のスタイル）は捨てる／書かない（ADR-0055 決定1）。
// ⚠️ **読めない所は黙って捨てない**＝読めなかった塊の数を返す（呼ぶ側が「◯件は読めませんでした」と言う・§2-5）。
// ⚠️ **見えない文字を直に書かない**＝BOM・NUL などは `String.fromCharCode` で作る（lint の no-irregular-whitespace／
//   取り回しの途中で消える・化けるのを防ぐ）。

/** 字幕1つぶん（秒）。 */
export interface SubtitleCue {
  startSec: number;
  endSec: number;
  text: string;
}

export const SUBTITLE_FILE_KIND = { srt: 'srt', vtt: 'vtt' } as const;
export type SubtitleFileKind = (typeof SUBTITLE_FILE_KIND)[keyof typeof SUBTITLE_FILE_KIND];

const BOM = String.fromCharCode(0xfeff);
const NUL = String.fromCharCode(0);

/**
 * 化けた読みの印（NUL・C1 制御文字・置き換え文字）を含むか。
 * ⚠️ **検査で直接見る**（export）＝Node の Shift_JIS は 0x80 などで例外を投げるが、WebView2（Chromium＝WHATWG の規則）は
 *   U+0080 として**通す**。アプリの中でだけ効く守りなので、復号の経路からは試せない（変異チェックで分かった）。
 */
export function hasGarbledChar(s: string): boolean {
  for (let k = 0; k < s.length; k += 1) {
    const c = s.charCodeAt(k);
    if (c === 0 || (c >= 0x80 && c <= 0x9f) || c === 0xfffd) return true;
  }
  return false;
}

/**
 * ファイルの中身（バイト列）を文字にする（ADR-0055 決定2）。
 * UTF-16（**BOM あり**）→ UTF-8（BOM あり・なし・NUL を含まない）→ **読めなければ Shift_JIS**（日本の古い字幕ファイル・化けた読みは捨てる）。
 * どれでもなければ null（BOM の無い UTF-16 は読めない扱い）。
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
  // ⚠️ **NUL を含むなら読めない**（PR #1355 レビュー 🟡）＝BOM の無い UTF-16 は UTF-8 として通ってしまい、
  //   「字幕が無い」と違う理由を言うことになる。字幕ファイルの文字に NUL は出ない。
  if (utf8 != null) return utf8.includes(NUL) ? null : utf8;
  const sjis = strict('shift_jis');
  // ⚠️ **化けた読みを成功にしない**（同 🟡）＝UTF-8 の中に壊れたバイトが混じったファイルを Shift_JIS で読み直すと、
  //   化けたまま通ることがある。制御文字（C1）・置き換え文字が出たら読めない扱い。
  return sjis != null && !hasGarbledChar(sjis) ? sjis : null;
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

/** 時刻の行か（全角の数字・記号も読む＝日本の手書きの字幕ファイル・PR #1355 レビュー ℹ️）。時刻の行なら正規化した文字。 */
function asTimeLine(line: string): string | null {
  const n = line.normalize('NFKC');
  return n.includes('-->') ? n : null;
}
const isNumberOnly = (l: string): boolean => /^\d+$/.test(l.normalize('NFKC').trim());

/**
 * 字幕ファイルの文字を読む（SRT と WebVTT のどちらも＝先頭の `WEBVTT` で見分けない・時刻の行で読む）。
 *
 * - **行ごとに読む**（PR #1355 レビュー 🟡）＝空行で塊に割るやり方だと、①`WEBVTT` の直後に空行の無いファイルで1件目が
 *   黙って消え ②空行の抜けた SRT で次の番号と時刻まで文として並んだ。時刻の行（`開始 --> 終わり`）が来るたびに新しい字幕を始め、
 *   文は**空行か次の時刻の行**まで（次の時刻の行の直前の数字だけの行は番号として捨てる）。
 * - 番号の行・VTT のキューの名前（時刻の行の直前の1行）は捨てる。`WEBVTT` の見出し（と続く設定の行）・`NOTE`／`STYLE`／`REGION` の塊は数えない。
 * - 時刻が読めない・終わりが始まり以前・文が空の字幕と、時刻の行を持たない文の塊は**読めなかった数**に入れる（黙って捨てない）。
 * - 時刻順に並べる（ファイルの並びが前後していても）。
 */
export function parseSubtitleFile(text: string): { cues: SubtitleCue[]; unreadable: number } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const n = lines.length;
  const blank = (i: number): boolean => i >= n || lines[i].trim() === '';
  // 次の時刻の行の直前の「番号／名前」の行か。
  const isCueLead = (i: number): boolean => i + 1 < n && !blank(i) && asTimeLine(lines[i + 1]) != null;
  const cues: SubtitleCue[] = [];
  let unreadable = 0;
  let i = 0;
  while (i < n) {
    if (blank(i)) { i += 1; continue; }
    const head = lines[i].trim();
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(head)) {
      // 見出し・注釈の塊は空行か時刻の行まで飛ばす（字幕ではないので数えない）。
      i += 1;
      while (!blank(i) && asTimeLine(lines[i]) == null) i += 1;
      continue;
    }
    const timeLine = asTimeLine(lines[i]);
    if (timeLine == null) {
      if (isCueLead(i)) { i += 1; continue; } // 番号・キューの名前
      // 時刻の行を持たない文の塊＝読めなかった1件（空行か時刻の行・次の字幕の番号まで飛ばす）。
      unreadable += 1;
      while (!blank(i) && asTimeLine(lines[i]) == null && !isCueLead(i)) i += 1;
      continue;
    }
    const [a, b] = timeLine.split('-->');
    const startSec = parseSubtitleTime(a);
    // VTT はキューの設定（`align:start` 等）が時刻の後ろに続く＝最初の語だけを時刻として読む。
    const endSec = parseSubtitleTime((b ?? '').trim().split(/\s+/)[0] ?? '');
    const body: string[] = [];
    i += 1;
    while (!blank(i) && asTimeLine(lines[i]) == null && !(isNumberOnly(lines[i]) && isCueLead(i))) {
      body.push(stripMarkup(lines[i]));
      i += 1;
    }
    const textBody = body.filter((l) => l.trim() !== '').join('\n');
    if (startSec == null || endSec == null || endSec <= startSec || textBody === '') { unreadable += 1; continue; }
    cues.push({ startSec, endSec, text: textBody });
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
    ? `${BOM}${parts.join('\n\n')}\n`
    : `WEBVTT\n\n${parts.join('\n\n')}\n`;
}

/** 保存先の拡張子から形式を決める（大文字小文字は問わない）。`.srt`／`.vtt` でなければ null。 */
export function subtitleFileKindOfPath(path: string): SubtitleFileKind | null {
  const ext = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase();
  return ext === SUBTITLE_FILE_KIND.srt || ext === SUBTITLE_FILE_KIND.vtt ? ext : null;
}

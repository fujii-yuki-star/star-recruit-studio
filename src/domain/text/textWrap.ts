// テキストの折返し（純粋関数）。layout（同時字幕の帯の段位置計算・ADR-0031）と sceneSvg（描画）が共有し、
// 「行数」と「描画」を一致させる＝重ならない自動配置とパリティ（ADR-0001）。
// 文字幅は**描く字体の実測表**から引く（ADR-0063・`fontMetrics.ts`）＝どの字体かは呼ぶ側が渡す（`TextFont`）。
import { charWidthEmIn, estimatedCharWidthEm, type TextFont } from './fontMetrics';

/**
 * 字体を問わない文字幅の見積もり（ADR-0063 より前の値）。半角(ASCII)は約0.55em、それ以外はほぼ1em。
 * ⚠️ **折返しには使わない**（字体ごとの実測は `wrapText` に `TextFont` を渡す）＝字体を選べない所
 *（権利表示のピル＝既定の字体に固定）だけが使う。
 */
export function charWidthEm(ch: string): number {
  return estimatedCharWidthEm(ch.codePointAt(0) ?? 0);
}

/**
 * 折る所になる空白（半角の空白・タブ）。
 * ⚠️ **全角空白と NBSP は入れない**（PR #1468 レビュー）＝どちらも SVG の既定の空白処理で消えないので、
 * 行末に残すと中央・右揃えで見える文字が寄る。NBSP はそもそも「ここで折らない」という意味の文字。
 */
const WHITESPACE = /[ \t]/;

/**
 * 欧文の単語を作る文字か（英数字・ラテン補助・ギリシャ・キリル・記号を含む＝U+2000 より前で空白でないもの）。
 * 日本語（かな・漢字・全角）は含まない＝どこでも折れる。
 */
function isWordChar(ch: string | undefined): boolean {
  if (ch == null) return false;
  return (ch.codePointAt(0) ?? 0) < 0x2000 && !WHITESPACE.test(ch);
}

// 幅(px)に収まるよう行へ分割する（全角/半角を区別）。字間（#264）も数える（#928）。
//
// ⚠️ **字間を数えないと、はみ出し判定が実際より狭く見る**＝字間を広げた文字は横に長くなるのに、
// 折返しの計算が字間なしの幅で見ていた（絵はプレビュー＝書き出しで同じ関数を共有するので割れないが、
// **画面外へ出る字幕に警告が出ない**＝`subtitleOverflowsCanvas` が見逃す）。maxLines を超える分は末尾を … で切る。
// 明示改行（\n）はハード改行として尊重する（FREE allLines の2行結合など・ADR-0031）＝各段落を幅で折り、全体を maxLines で打ち切る。
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number,
  letterSpacingEm: number,
  /**
   * 描く字体（ADR-0063）。⚠️ **必ず渡す**（省略できない引数にしてある）＝渡し忘れると描く字体と違う幅で折り返し、
   * 行数・帯の段・はみ出しの判定が絵と食い違う。`undefined` は「字体を問わない見積もり」（検査用）。
   */
  font: TextFont | undefined,
): string[] {
  if (maxWidth < fontSize || maxLines < 1) return [text];
  // 字間（#264・#928）＝**文字と文字のあいだ**に入る送り。`em` で持つので px へ直す。
  // ⚠️ **末尾の字間は数えない**＝最後の文字のうしろに送りは要らない（数えると1文字ぶん狭く見え、
  // 実際には入る文字を折り返す）。だから「2文字目以降に足す」形にする。
  // ⚠️ **未指定（0）のときは何も足さない**＝**字間を設定していない動画の折返しは1文字も変わらない**。
  // ⚠️ **字間を設定している動画は折返しが変わる**（PR #937 レビュー＝#264 は既に出荷済みなので実在する）。
  // それが**この修正の目的**＝これまでは字間ぶんを数えずに詰め込み、描くときだけ横に伸びていた。
  const spacingPx = letterSpacingEm * fontSize;
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  const truncateLast = (): string[] => {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, last.length - 1))}…`;
    return lines;
  };
  const widthOf = (ch: string): number => charWidthEmIn(ch, font) * fontSize;
  for (let p = 0; p < paragraphs.length; p += 1) {
    const chars = [...paragraphs[p]];
    let line = '';
    let lineW = 0;
    let lineChars = 0; // 送りは「2文字目以降」に足すので、行の文字数で数える（`line.length` は絵文字で狂う）
    for (let i = 0; i < chars.length; i += 1) {
      const w = widthOf(chars[i]) + (lineChars > 0 ? spacingPx : 0);
      if (lineW + w > maxWidth && line.length > 0) {
        // ⚠️ **空白は前の行の末尾に残す**（英字の折返し・2026-10-19）＝描くと見えず、つなげ直すと
        // 元の文に戻る（切り詰めの判定 `truncatedTexts` は「つなげた行＝元の文」で見るので、消すと
        // 折り返しただけで「切れている」と誤って出る）。次の行は空白から始まらない。
        const isSpace = WHITESPACE.test(chars[i]);
        if (isSpace) line += chars[i];
        // ⚠️ **英字の単語の途中では折らない**（業界の型＝欧文は単語の切れ目で折る・2026-10-19）＝
        // 行末が単語の途中なら、単語の頭までを次の行へ送る。行全体が1語（行より長い語）なら
        // 送る先が無いので従来どおり文字で折る。日本語は従来どおり文字ごと（どこでも折れる）。
        let carry: string[] = [];
        if (!isSpace && isWordChar(chars[i])) {
          const cur = [...line];
          let head = cur.length;
          while (head > 0 && isWordChar(cur[head - 1])) head -= 1;
          // ⚠️ **送った先でも入らないなら送らない**（PR #1468 レビュー 🟡）＝単語の前が細い（行頭の空白・「“」
          // など）と、送った単語＋はみ出した1文字が新しい行でも枠を超えたまま確定する。そのときは
          // 従来どおり文字で折る（箱からはみ出さない側）。
          const carryW = cur.slice(head).reduce((sum, ch, k) => sum + widthOf(ch) + (k > 0 ? spacingPx : 0), 0);
          if (head > 0 && head < cur.length && carryW + w <= maxWidth) {
            carry = cur.slice(head);
            line = cur.slice(0, head).join('');
          }
        }
        lines.push(line);
        if (lines.length >= maxLines) {
          // 行数上限に到達。まだ文字（送る単語・この段落の残り・後続段落）があれば直前の行末を … にする。
          const rest = carry.length + chars.length - i - (isSpace ? 1 : 0);
          if (rest > 0 || p + 1 < paragraphs.length) return truncateLast();
          return lines;
        }
        // 送った単語で新しい行を始める（字間は2文字目以降）。
        line = carry.join('');
        lineW = carry.reduce((sum, ch, k) => sum + widthOf(ch) + (k > 0 ? spacingPx : 0), 0);
        lineChars = carry.length;
        if (isSpace) continue;
      }
      line += chars[i];
      // ⚠️ **ここで数え直す**＝`w` は**折り返す前**（この行にまだ文字があった時点）に計算しており、
      // 折り返した直後はその文字が**新しい行の1文字目**になるので、`w` に入っている送りは要らない。
      // ⚠️ PR #937 のレビューで「この三項は冗長」と読まれ、こちらもそう答えたが**どちらも誤り**
      // （単純化したらテストが落ちた）。`w` の中の三項は**折り返す前の `lineChars`** を見ている、が要点。
      // （単語を送ったときは `lineChars > 0` のまま＝送りを足した `w` がそのまま正しい。）
      lineW += lineChars === 0 ? widthOf(chars[i]) : w;
      lineChars += 1;
    }
    if (line.length > 0) {
      lines.push(line);
      // 段落末で上限到達＝後続段落が残るなら … で打ち切る（同時字幕の3人目以降が溢れたら省略）。
      if (lines.length >= maxLines && p + 1 < paragraphs.length) return truncateLast();
    }
  }
  return lines;
}

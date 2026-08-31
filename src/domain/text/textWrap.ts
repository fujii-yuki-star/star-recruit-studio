// テキストの折返し（純粋関数）。layout（同時字幕の帯の段位置計算・ADR-0031）と sceneSvg（描画）が共有し、
// 「行数」と「描画」を一致させる＝重ならない自動配置とパリティ（ADR-0001）。文字幅はフォント実測の代替（05 §10）。

// 文字幅の概算（フォント実測の代替・05 §10 / ADR-0001 未解決）。半角(ASCII)は約0.55em、
// それ以外（日本語など全角）はほぼ1em。全角を 0.58em 一律とみなすと縦型の狭幅で折返し不足＝見切れるため区別する。
export function charWidthEm(ch: string): number {
  return ch.charCodeAt(0) <= 0xff ? 0.55 : 1.0;
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
  letterSpacingEm = 0,
): string[] {
  if (maxWidth < fontSize || maxLines < 1) return [text];
  // 字間（#264・#928）＝**文字と文字のあいだ**に入る送り。`em` で持つので px へ直す。
  // ⚠️ **末尾の字間は数えない**＝最後の文字のうしろに送りは要らない（数えると1文字ぶん狭く見え、
  // 実際には入る文字を折り返す）。だから「2文字目以降に足す」形にする。
  // ⚠️ **未指定（0）のときは何も足さない**＝**従来の折返しは1文字も変わらない**（既に作った動画の絵を変えない）。
  const spacingPx = letterSpacingEm * fontSize;
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  const truncateLast = (): string[] => {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, last.length - 1))}…`;
    return lines;
  };
  for (let p = 0; p < paragraphs.length; p += 1) {
    const chars = [...paragraphs[p]];
    let line = '';
    let lineW = 0;
    let lineChars = 0; // 送りは「2文字目以降」に足すので、行の文字数で数える（`line.length` は絵文字で狂う）
    for (let i = 0; i < chars.length; i += 1) {
      const w = charWidthEm(chars[i]) * fontSize + (lineChars > 0 ? spacingPx : 0);
      if (lineW + w > maxWidth && line.length > 0) {
        lines.push(line);
        line = '';
        lineW = 0;
        lineChars = 0;
        if (lines.length >= maxLines) {
          // 行数上限に到達。まだ文字（この段落の残り or 後続段落）があれば直前の行末を … にする。
          if (chars.slice(i).join('').length > 0 || p + 1 < paragraphs.length) return truncateLast();
          return lines;
        }
      }
      line += chars[i];
      // 行頭へ送り直したときは、その文字は「1文字目」＝送りを足さない。
      lineW += lineChars === 0 ? charWidthEm(chars[i]) * fontSize : w;
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

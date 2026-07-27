// テキストの折返し（純粋関数）。layout（同時字幕の帯の段位置計算・ADR-0031）と sceneSvg（描画）が共有し、
// 「行数」と「描画」を一致させる＝重ならない自動配置とパリティ（ADR-0001）。文字幅はフォント実測の代替（05 §10）。

// 文字幅の概算（フォント実測の代替・05 §10 / ADR-0001 未解決）。半角(ASCII)は約0.55em、
// それ以外（日本語など全角）はほぼ1em。全角を 0.58em 一律とみなすと縦型の狭幅で折返し不足＝見切れるため区別する。
export function charWidthEm(ch: string): number {
  return ch.charCodeAt(0) <= 0xff ? 0.55 : 1.0;
}

// 幅(px)に収まるよう行へ分割する（全角/半角を区別）。maxLines を超える分は末尾を … で切る。
// 明示改行（\n）はハード改行として尊重する（FREE allLines の2行結合など・ADR-0031）＝各段落を幅で折り、全体を maxLines で打ち切る。
export function wrapText(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  if (maxWidth < fontSize || maxLines < 1) return [text];
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
    for (let i = 0; i < chars.length; i += 1) {
      const w = charWidthEm(chars[i]) * fontSize;
      if (lineW + w > maxWidth && line.length > 0) {
        lines.push(line);
        line = '';
        lineW = 0;
        if (lines.length >= maxLines) {
          // 行数上限に到達。まだ文字（この段落の残り or 後続段落）があれば直前の行末を … にする。
          if (chars.slice(i).join('').length > 0 || p + 1 < paragraphs.length) return truncateLast();
          return lines;
        }
      }
      line += chars[i];
      lineW += w;
    }
    if (line.length > 0) {
      lines.push(line);
      // 段落末で上限到達＝後続段落が残るなら … で打ち切る（同時字幕の3人目以降が溢れたら省略）。
      if (lines.length >= maxLines && p + 1 < paragraphs.length) return truncateLast();
    }
  }
  return lines;
}

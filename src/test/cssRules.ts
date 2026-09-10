// スタイルシートの「規則の中身」を取り出す道具（検査用）。
//
// ⚠️ **jsdom は CSS ファイルを読まない**＝描いて確かめられないので、**書き方そのもの**を見る検査が要る。
// 実寸の確認は `tools/uiProbe.mjs`（実 UI を操作して測る）。
//
// ⚠️ **写して増やさない**（#1104）＝同じ取り出しを2つの検査（`timelineMetrics` と `PanelLayoutView`）が
// 使うので、拾い方は**ここ1か所**に置く。拾い方自体の検査は `timelineMetrics.test.ts` の
// 「門番自身の検査」にある。

/**
 * 規則の中身（`{` から `}` まで）を取り出す。無ければ `null`。
 *
 * ⚠️ **`null` を返す**＝規則ごと消えたときに「中身が空だから通った」にしない（見落とす側に倒れる）。
 * ⚠️ **行頭で当てる**（#1104）＝そうしないと `.timeline-panel > .timeline > .timeline-scroll {` が
 * `.timeline-scroll {` の探しものに**先に当たって**、別の規則の中身を見て通ってしまう
 *（この綴りは実際に足した＝当たり前に踏む）。
 */
export function ruleBody(source: string, selector: string): string | null {
  const head = `${selector} {`;
  const at = source.startsWith(head) ? 0 : source.indexOf(`\n${head}`);
  if (at < 0) return null;
  const open = source.indexOf("{", at);
  const end = source.indexOf("}", open);
  if (end < 0) return null;
  return source.slice(open + 1, end);
}

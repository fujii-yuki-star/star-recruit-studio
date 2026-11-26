/** アプリの名前（窓の題・画面の見出しで同じものを使う）。 */
export const APP_TITLE = "すたりおMV";

/**
 * すたりおMV（γ）の骨組み（#1337 §15 ④）。⚠️ **まだ何もしない**＝起動して窓が出ることの確認だけ。
 * 中身は γ0.1（ADR-0074 決定6）から。
 */
export function App(): React.JSX.Element {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>{APP_TITLE}</h1>
      <p>準備中です。</p>
    </main>
  );
}

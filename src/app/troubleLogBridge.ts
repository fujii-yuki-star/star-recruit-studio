// 画面側の技術詳細を、うまくいかないときの記録へ流す（#396）。
//
// ⚠️ **`console` を包む**＝診断の出力は 37 か所に散らばっており、1か所ずつ書き換えると
// **足し忘れた所だけ記録が残らない**（Rust 側で `AppHandle` を持ち回らなかったのと同じ理由）。
// これから増える分も自動で乗る。
// ⚠️ **`warn` と `error` だけ**＝`log`/`info` は普段の動きの実況なので、混ぜると肝心の失敗が埋もれる。
// ⚠️ **元の `console` は必ず呼ぶ**＝開発中の見え方を変えない。
// ⚠️ **外へは送らない**（§2-6）＝このパソコンの中のファイルへ書くだけ。
import { invoke } from "@tauri-apps/api/core";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 引数1つを1行の文字列にする。⚠️ **`Error` は message だけでは足りない**（どこで起きたかが消える）。 */
function toText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

let installed = false;

/**
 * 起動時に一度だけ仕掛ける。
 *
 * ⚠️ **二重に包まない**＝包むたびに1回の出力が2件・4件と増える（画面の再読込を挟むと起きうる）。
 * ⚠️ **記録に失敗しても元の出力は止めない**＝記録は「あると助かる」もので、
 * 失敗が握りつぶされる理由にはならない。
 */
export function installTroubleLogBridge(): void {
  if (installed || !isTauri()) return;
  installed = true;
  (["warn", "error"] as const).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      // ⚠️ **記録の失敗をここで `console` へ出さない**＝自分を呼び直して無限に回る。
      // ⚠️ **投げても包み込む**＝記録は「あると助かる」もので、**失敗が `console.warn` を壊す**なら
      // 本末転倒（元の出力の直後に投げると、呼び出し側の処理が途中で止まる）。
      // `Promise.resolve` で包むのは、返りが約束でない場合にも同じ道を通すため。
      try {
        void Promise.resolve(
          invoke("trouble_log_record", { tag: `ui:${level}`, detail: args.map(toText).join(" ") }),
        ).catch(() => { /* 残せなくても画面は止めない */ });
      } catch { /* 同上 */ }
    };
  });
}

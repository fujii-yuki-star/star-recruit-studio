// `Escape` を**いま自分で受け持っているもの**の名簿（#701 レビュー）。
//
// `Escape` は「いちばん手前のものを1段はがす」キー。ところが受け手（メニュー・ドラッグの中止・確認）は
// それぞれ独立に `window` を購読していて、**同時に発火する**。画面側が「開いているもの」を手で数える形にすると、
// 受け手が増えるたびに数え漏れて**同じ穴が開き続ける**（実際に、欄のドラッグ中止と欄のメニューを数え漏らした）。
//
// そこで**受け持っている側が名乗る**形にする。画面は「誰か名乗っているか」だけを見て、名乗り手がいる間は
// 自分の `Escape`（＝いちばん外側の後始末）を実行しない。新しい受け手は名乗るだけで自動的に順番へ入る。
//
// ⚠️ **名簿が配る**（#965）。当初は数を数えるだけで、**前に出ているものどうしを調停していなかった**＝
// 2つ同時に開いていると1回の `Escape` で**両方いっぺんに閉じた**（「手前から1段ずつはがす」から外れる）。
// 名簿に順序を持たせるだけでは足りない＝**受け取らなかった受け手が下も黙らせる**（下の受け手はもう走った後で、
// 手前が見送ったことを知りようがない）。だから**購読を名簿が1つだけ持ち、手前から順に渡して、
// 受け取ったところで止める**。
//
// - **受け手**（`useEscapeReceiver` / `claimEscapeReceiver`）＝処理する関数を預ける。
//   **受け取ったら `true`・見送ったら `false`** を返す（見送りは**次の受け手へ渡る**＝黙って死なない・§2-5）。
// - **塞ぐだけ**（`useEscapeOwner` / `claimEscape`）＝自分では処理せず、外側の後始末を止めるためだけに名乗る。
//   配る相手にはならない＝画面が「確認が出ている間」を名乗っても、**確認自身の番を奪わない**。
//
// ⚠️ **キャンバスの掴み**（`FreeLayoutOverlay`／`TemplateLayerOverlay`）は capture で購読して
// `stopPropagation` するので、**この名簿より先に独占する**（掴んでいる間は掴みの中止だけが走る）。
// そちらは「塞ぐだけ」で足りる＝`useCanvasDrag` は `claimEscape` のまま。
import { useEffect, useRef } from "react";

/** `Escape` を処理する関数。**受け取ったら `true`**（見送ると次の受け手へ渡る）。 */
export type EscapeHandler = (e: KeyboardEvent) => boolean;

/** 名乗り1つ分の札。`handler` が `null`＝塞ぐだけ（配る相手にならない）。 */
interface Owner {
  readonly handler: EscapeHandler | null;
}

/** いま名乗っているもの（**後ろほど手前**）。 */
const owners: Owner[] = [];
let listening = false;

/** `Escape` を受け持っているものがあるか。**いちばん外側の後始末をする側**が見る。 */
export function hasEscapeOwner(): boolean {
  return owners.length > 0;
}

/**
 * 名簿の**手前から順に渡し、受け取ったところで止める**。受け取り手がいなければ `false`。
 * ⚠️ 窓の購読はこれ1つ＝受け手が自分で `window` を購読すると、**発火の順が名乗りの順と食い違う**
 * （購読した順に走るので、手前が見送るより先に奥が走ってしまう）。
 */
export function handleEscapeKey(e: KeyboardEvent): boolean {
  // ⚠️ **控えを取ってから回す**＝処理の中で名簿が変わる（閉じれば降りる）。
  const snapshot = owners.slice();
  for (let i = snapshot.length - 1; i >= 0; i -= 1) {
    const o = snapshot[i];
    // ⚠️ **もう降りたものへは渡さない**＝手前の処理で消えていることがある。
    if (!o || !o.handler || !owners.includes(o)) continue;
    if (o.handler(e)) return true;
  }
  return false;
}

function onWindowKeyDown(e: KeyboardEvent): void {
  if (e.key === "Escape") handleEscapeKey(e);
}

function push(handler: EscapeHandler | null): Owner {
  const o: Owner = { handler };
  owners.push(o);
  // ⚠️ **名乗りがある間だけ購読する**（`typeof window` を見るのは node のテストでも読み込まれるため）。
  if (!listening && typeof window !== "undefined") {
    window.addEventListener("keydown", onWindowKeyDown);
    listening = true;
  }
  return o;
}

function pop(o: Owner): void {
  const i = owners.indexOf(o);
  // ⚠️ **番号ではなく札そのもので探す**＝内側が先に降りることがあるので、位置は当てにならない。
  if (i >= 0) owners.splice(i, 1);
  if (listening && owners.length === 0 && typeof window !== "undefined") {
    window.removeEventListener("keydown", onWindowKeyDown);
    listening = false;
  }
}

/**
 * `Escape` を受け持っている間だけ名乗る（`active` が true の間）＝**塞ぐだけ**。
 * 自分で `Escape` を処理する部品は `useEscapeReceiver` を使う（そちらは配る相手になる）。
 */
export function useEscapeOwner(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const o = push(null);
    return () => pop(o);
  }, [active]);
}

/**
 * `Escape` を**自分で処理する**部品が名乗る（`active` が true の間）。
 * `onEscape` は**受け取ったら `true`**を返す（`false` を返すと次の受け手へ渡る）。
 * ⚠️ **自分で `window` を購読しない**＝配るのは名簿（購読の順と名乗りの順が食い違わない）。
 */
export function useEscapeReceiver(active: boolean, onEscape: EscapeHandler): void {
  // ⚠️ **関数は控えで受け渡す**＝毎レンダー新しくなる関数を依存に入れると、名乗り直しで順番が入れ替わる。
  const ref = useRef(onEscape);
  useEffect(() => {
    ref.current = onEscape;
  });
  useEffect(() => {
    if (!active) return;
    const o = push((e) => ref.current(e));
    return () => pop(o);
  }, [active]);
}

/**
 * 部品ではない場所（イベント購読の中など）から名乗るとき用の**塞ぐだけ**。**返ってくる関数を必ず呼ぶ**
 * （呼ばないと名乗ったままになり、`Escape` が永久に効かなくなる）。
 */
export function claimEscape(): () => void {
  const o = push(null);
  let released = false;
  return () => {
    if (released) return; // 二重に外しても数がずれない
    released = true;
    pop(o);
  };
}

/**
 * 部品ではない場所から名乗る、**自分で `Escape` を処理する**受け手（#965）。
 * `onEscape` の返り値の意味は `useEscapeReceiver` と同じ。**返ってくる関数を必ず呼ぶ**。
 */
export function claimEscapeReceiver(onEscape: EscapeHandler): () => void {
  const o = push(onEscape);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pop(o);
  };
}

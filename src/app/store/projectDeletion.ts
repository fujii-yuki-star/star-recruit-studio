// 動画を消したことを、**それを開いているかもしれない別の store** へ知らせる（#755）。
//
// ⚠️ **なぜ受け渡しを1つ挟むか**：`timelineStore` は `projectStore` を読んでいる。逆向きに読むと
// 輪になり、store の作られる順で片方が空になる。**どちらもこの小さな入れ物だけを見る**形にすれば
// 輪にならない。
//
// ⚠️ **なぜ要るか**：画面を離れても store は文書を持ったままなので（本番の導線は
// `closeTimelineProject` を通らない）、消した後に非同期の着地（声の完成・素材の取り込み）が
// 保存すると、**フォルダごと `project.json` を作り直して一覧へ復活する**（素材と声のファイルは
// 消えているので、開いても壊れている）。場面形式は同じ事故（#383）を `deleteProject` の中で
// 塞いでいるが、別 store には届かない。

type Listener = (projectId: string) => void;

const listeners = new Set<Listener>();

/** 消えたことを受け取る。返す関数で外す（付けっぱなしにしない）。 */
export function onProjectDeleted(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * 消えたことを知らせる。⚠️ **消す前に**呼ぶ（`/canon-check`）＝消している最中に非同期の着地が
 * 保存すると、**素材と声だけ消えた動画が一覧へ戻る**。受け手は「もう無いもの」として片づける。
 * 受け手が投げても他の受け手へ伝える＝1つの失敗で残りが片づかない、を作らない。
 */
export function emitProjectDeleted(projectId: string): void {
  for (const fn of [...listeners]) {
    try {
      fn(projectId);
    } catch {
      /* 受け手の都合で他を止めない */
    }
  }
}

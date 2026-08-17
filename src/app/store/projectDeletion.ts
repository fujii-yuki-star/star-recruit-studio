// 動画を消したことを、**それを開いているかもしれない別の store** へ知らせる（#755）。
//
// ⚠️ **なぜ受け渡しを1つ挟むか**：`timelineStore` は `projectStore` を読んでいる。逆向きに読むと
// 輪になり、store の作られる順で片方が空になる。**どちらもこの小さな入れ物だけを見る**形にすれば
// 輪にならない。**消す側から相手の store を直接触らない**のはこのため（#763-4 レビュー）。
//
// ⚠️ **なぜ要るか**：画面を離れても store は文書を持ったままなので（本番の導線は
// `closeTimelineProject` を通らない）、消した後に非同期の着地（声の完成・素材の取り込み）が
// 保存すると、**フォルダごと `project.json` を作り直して一覧へ復活する**（素材と声のファイルは
// 消えているので、開いても壊れている）。場面形式は同じ事故（#383）を `deleteProject` の中で
// 塞いでいるが、別 store には届かない。

/**
 * 受け手が返すもの（どちらも任意）。**手放したなら、待つ手段と戻す手段を一緒に返す**（#763-4）。
 *
 * ⚠️ 知らせるだけでは足りない理由が2つある：
 * - **`pending`**＝「これ以上書かない」にはできるが、**すでに発行済みの書き込み**は止められない。
 *   消した**後**に着地すると `save_project` がフォルダごと作り直す＝消したはずの動画が一覧へ戻る。
 * - **`restore`**＝消す前に手放すので、**消せなかったとき**に戻せないと、一覧には動画が残るのに
 *   その画面だけ空になる（利用者から見ると作業が消えたように見える）。
 */
export interface DeletionHandoff {
  /** 進行中の書き込み（消す前に着地を待つ）。無ければ省略。 */
  pending?: Promise<void>;
  /** 消せなかったときに元へ戻す（手放していないなら省略）。 */
  restore?: () => void | Promise<void>;
}

/** 受け手。手放したものがあれば `DeletionHandoff` を返す。 */
type Listener = (projectId: string) => void | DeletionHandoff;

const listeners = new Set<Listener>();

/** 消えたことを受け取る。返す関数で外す（付けっぱなしにしない）。 */
export function onProjectDeleted(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * 消えたことを知らせ、**受け手の進行中の書き込みが着地するまで待つ**。
 * 戻り値は**消せなかったときに呼ぶ「元へ戻す手」**（成功したら呼ばない）。
 *
 * ⚠️ **消す前に呼ぶ**（`/canon-check`）＝消している最中に非同期の着地が保存すると、
 * **素材と声だけ消えた動画が一覧へ戻る**。
 * ⚠️ **失敗した書き込みも待つ**（着地したかどうかだけが要る）。
 * 受け手が投げても他の受け手へ伝える＝1つの失敗で残りが片づかない、を作らない。
 */
export async function emitProjectDeleted(projectId: string): Promise<() => Promise<void>> {
  const landing: Promise<void>[] = [];
  const restores: (() => void | Promise<void>)[] = [];
  for (const fn of [...listeners]) {
    try {
      const handoff = fn(projectId);
      if (!handoff) continue;
      if (handoff.pending) landing.push(handoff.pending.catch(() => { /* 着地したことだけが要る */ }));
      if (handoff.restore) restores.push(handoff.restore);
    } catch {
      /* 受け手の都合で他を止めない */
    }
  }
  await Promise.all(landing);
  return async () => {
    // 戻せなかった受け手があっても、他の受け手は戻す（1つの失敗で残りが空のまま残らない）。
    for (const restore of restores) {
      try {
        await restore();
      } catch {
        /* 戻せない相手は諦める（消せなかった理由は呼び出し側が出す） */
      }
    }
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { editApi, type HistoryStatus } from "./api";
import type { EditDoc, Op } from "./types";

/** 編集の状態（動画の全体と版・知らせ）と、取引を送る手続き（MV-0008 決定1・2）。 */
export interface Editor {
  doc: EditDoc | null;
  /** 断られた理由（何も変えていない）。 */
  error: string | null;
  /** 知らせ（当て直した など）。 */
  notice: string | null;
  /** 1つの操作＝1つの取引。反映できたら true。 */
  commit: (ops: Op[]) => Promise<boolean>;
  /** 掴んで動かしている途中の見え方（保存しない）。 */
  trial: (ops: Op[] | null) => void;
  /** 読み直す（外の変更を受けたとき）。 */
  refresh: () => Promise<void>;
  /** 戻せる取引・やり直せる取引の名前（MV-0009）。 */
  history: HistoryStatus;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  clearMessages: () => void;
}

/** 戻せるものもやり直せるものも無い。 */
const NO_HISTORY: HistoryStatus = { undo: null, redo: null };

export const REAPPLIED_NOTICE = "AI の変更のあとの中身に、同じ操作を当て直しました。";

export function useEditor(dir: string | null): Editor {
  // ⚠️ 読んだ動画のフォルダと一緒に持つ＝別の動画を開いた直後に、前の動画の中身で編集しない
  const [loaded, setLoaded] = useState<{ dir: string; doc: EditDoc } | null>(null);
  const doc = loaded && loaded.dir === dir ? loaded.doc : null;
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryStatus>(NO_HISTORY);
  const [notice, setNotice] = useState<string | null>(null);
  // ⚠️ 版は最新を見る＝描き直しを待たずに続けて操作しても、前の取引の版で送らない
  const revision = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!dir) return;
    try {
      const d = await editApi.read(dir);
      revision.current = d.revision;
      setLoaded({ dir, doc: d });
      setHistory((await editApi.history(dir)) ?? NO_HISTORY);
    } catch (e) {
      setError(String(e));
    }
  }, [dir]);

  // 開いた動画を読む（外のものを受けて状態にする＝受け取ってから入れる）
  useEffect(() => {
    if (!dir) return;
    let alive = true;
    revision.current = null;
    editApi.read(dir).then(
      (d) => {
        if (!alive) return;
        revision.current = d.revision;
        setLoaded({ dir, doc: d });
        void editApi.history(dir).then((h) => {
          if (alive) setHistory(h ?? NO_HISTORY);
        });
      },
      (e: unknown) => {
        if (alive) setError(String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [dir]);

  const commit = useCallback(
    async (ops: Op[]): Promise<boolean> => {
      if (!dir || ops.length === 0) return false;
      try {
        const r = await editApi.apply(dir, ops, revision.current);
        revision.current = r.revision;
        setError(null);
        // ⚠️ 反映したが知らせたいこと（見た目を保てなかった など）は必ず出す＝黙って別の見た目にしない
        const notes = [...(r.reapplied ? [REAPPLIED_NOTICE] : []), ...(r.warnings ?? [])];
        setNotice(notes.length > 0 ? notes.join(" ") : null);
        await refresh();
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      }
    },
    [dir, refresh],
  );

  // 元に戻す・やり直す（MV-0009 決定6）。断られたら理由を出す（何も変えていない）。
  const stepHistory = useCallback(
    async (undo: boolean): Promise<void> => {
      if (!dir) return;
      try {
        await (undo ? editApi.undo(dir) : editApi.redo(dir));
        setError(null);
        setNotice(null);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [dir, refresh],
  );
  const undo = useCallback(() => stepHistory(true), [stepHistory]);
  const redo = useCallback(() => stepHistory(false), [stepHistory]);

  const trial = useCallback((ops: Op[] | null) => {
    void editApi.trial(ops);
  }, []);

  const clearMessages = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  return { doc, error, notice, commit, trial, refresh, clearMessages, history, undo, redo };
}

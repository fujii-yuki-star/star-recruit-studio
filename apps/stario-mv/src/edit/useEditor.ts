import { useCallback, useEffect, useRef, useState } from "react";
import { editApi } from "./api";
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
  clearMessages: () => void;
}

export const REAPPLIED_NOTICE = "AI の変更のあとの中身に、同じ操作を当て直しました。";

export function useEditor(dir: string | null): Editor {
  // ⚠️ 読んだ動画のフォルダと一緒に持つ＝別の動画を開いた直後に、前の動画の中身で編集しない
  const [loaded, setLoaded] = useState<{ dir: string; doc: EditDoc } | null>(null);
  const doc = loaded && loaded.dir === dir ? loaded.doc : null;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // ⚠️ 版は最新を見る＝描き直しを待たずに続けて操作しても、前の取引の版で送らない
  const revision = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!dir) return;
    try {
      const d = await editApi.read(dir);
      revision.current = d.revision;
      setLoaded({ dir, doc: d });
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
        setNotice(r.reapplied ? REAPPLIED_NOTICE : null);
        await refresh();
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      }
    },
    [dir, refresh],
  );

  const trial = useCallback((ops: Op[] | null) => {
    void editApi.trial(ops);
  }, []);

  const clearMessages = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  return { doc, error, notice, commit, trial, refresh, clearMessages };
}

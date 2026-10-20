// 使っていないファイルを片づける（ADR-0064）。動画の一覧から開く。
//
// ⚠️ **業界の型**＝自動では消さない・消す前に一覧を見せる・チェックを外せば残せる・ごみ箱へ移す（戻せる）。
// ⚠️ **「使っている」の判定は Rust の1か所**（`list_unused_project_files`）＝ここは見せて選ばせるだけ。
import { useEffect, useState } from "react";
import { listUnusedProjectFiles, trashUnusedProjectFiles, type UnusedFile } from "../../infrastructure/assetFs";
import { cleanupBusy, liveDocumentTexts } from "../store/liveDocumentTexts";
import { formatDiskSize, unusedFileKindLabel, unusedFilesLabel, unusedFilesTrashedMessage } from "../uiLabels";
import { userFacingMessage } from "../userFacingError";

export function UnusedFilesPanel({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [files, setFiles] = useState<UnusedFile[] | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  // ⚠️ **走っている間は調べない**（書きかけのファイルはまだどの文書にも無い）＝開いた時点で決める。
  const [busyAtOpen] = useState(() => cleanupBusy(projectId));
  const [error, setError] = useState<string | null>(busyAtOpen ? unusedFilesLabel.busy : null);
  const [done, setDone] = useState<string | null>(null);
  const [trashing, setTrashing] = useState(false);

  useEffect(() => {
    let alive = true;
    if (busyAtOpen) return;
    listUnusedProjectFiles(projectId, liveDocumentTexts(projectId))
      .then((list) => {
        if (!alive) return;
        setFiles(list);
        setChecked(new Set(list.map((f) => f.path))); // 既定は全部選ぶ（Logic Pro と同じ）
      })
      .catch((e: unknown) => {
        if (alive) setError(userFacingMessage(e, "unused-files") ?? unusedFilesLabel.busy);
      });
    return () => { alive = false; };
  }, [projectId, busyAtOpen]);

  const selected = (files ?? []).filter((f) => checked.has(f.path));
  const total = selected.reduce((s, f) => s + f.size, 0);

  async function onTrash(): Promise<void> {
    if (selected.length === 0 || trashing) return;
    // ⚠️ **押した時点でも走っていないか見直す**（一覧を見ている間に取り込みが始まりうる）。
    if (cleanupBusy(projectId)) { setError(unusedFilesLabel.busy); return; }
    setTrashing(true);
    setError(null);
    try {
      const n = await trashUnusedProjectFiles(projectId, selected.map((f) => f.path), liveDocumentTexts(projectId));
      setDone(unusedFilesTrashedMessage(n));
      setFiles(null);
    } catch (e) {
      setError(userFacingMessage(e, "unused-files-trash") ?? unusedFilesLabel.busy);
    } finally {
      setTrashing(false);
    }
  }

  const toggle = (path: string): void =>
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="notice mb" role="region" aria-label={unusedFilesLabel.action} style={{ flexDirection: "column", alignItems: "stretch" }}>
      <div className="row-between">
        <strong>{unusedFilesLabel.action}</strong>
        <button className="btn btn-ghost" onClick={onClose} disabled={trashing}>{unusedFilesLabel.close}</button>
      </div>
      {error && <p className="notice notice-warn" role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}
      {!error && !done && files === null && <p className="text-muted">{unusedFilesLabel.checking}</p>}
      {files !== null && files.length === 0 && <p>{unusedFilesLabel.empty}</p>}
      {files !== null && files.length > 0 && (
        <>
          <p className="text-sm">{unusedFilesLabel.intro}</p>
          <ul className="list-reset" style={{ maxHeight: "16rem", overflowY: "auto" }}>
            {files.map((f) => (
              <li key={f.path}>
                <label className="row gap-sm">
                  <input type="checkbox" checked={checked.has(f.path)} onChange={() => toggle(f.path)} disabled={trashing} />
                  <span className="grow">{unusedFileKindLabel(f.path)}：{f.path.slice(f.path.lastIndexOf("/") + 1)}</span>
                  <span className="text-sm text-muted">{formatDiskSize(f.size)}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="row-between mt">
            <span className="text-sm">{selected.length}個・{formatDiskSize(total)}</span>
            <button className="btn btn-primary" onClick={() => void onTrash()} disabled={trashing || selected.length === 0}>
              {trashing ? unusedFilesLabel.trashing : unusedFilesLabel.trash}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

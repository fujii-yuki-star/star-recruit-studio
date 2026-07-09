import { useEffect, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import { PROJECT_NAME_MAX_LENGTH } from "../../domain/constants";
import type { ProjectSummary } from "../../infrastructure/projectFs";
import { useStartNewProject } from "../hooks/useStartNewProject";
import { YukoPanel } from "../components/YukoPanel";
import { DeleteConfirm } from "../components/DeleteConfirm";
import {
  PlusIcon,
  LayoutIcon,
  SettingsIcon,
  FilmIcon,
  ChevronRightIcon,
  FolderIcon,
  TrashIcon,
  PencilIcon,
} from "../components/icons";

interface HomeProps {
  onNavigate: (screen: ScreenId) => void;
}

function formatDate(iso: string): string {
  return iso ? iso.slice(0, 10) : "—";
}

export function HomeScreen({ onNavigate }: HomeProps) {
  const listProjects = useProjectStore((s) => s.listProjects);
  const loadProject = useProjectStore((s) => s.loadProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  // 書き出し中はプロジェクトの切替/削除/新規をブロック（#379）。store 側も no-op で守るが、UI でも無効化して
  // 「削除→一覧から消える（実体は残る）」等の不整合と誤操作を防ぐ。
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase));
  const renameProject = useProjectStore((s) => s.renameProject);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  // 「新しい動画を作る」はヘッダと同じ破棄ガード付きフロー（共有フックで挙動統一）。
  const { confirming: confirmNew, start: startNew, startBlank, confirm: confirmStartNew, cancel: cancelNew } =
    useStartNewProject(onNavigate);
  // プロジェクトを開けなかったときのユーザー向け表示（§2-5）。
  const [openError, setOpenError] = useState(false);
  // 削除：確認中のプロジェクトID・操作中（連打防止）・失敗表示（§2-5）。
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  async function removeProject(projectId: string) {
    if (deleteBusy || isExporting) return; // 書き出し中は削除しない（no-op 後に一覧だけ消える不整合を防ぐ・#379）
    setDeleteBusy(true);
    setDeleteError(false);
    try {
      await deleteProject(projectId);
      setProjects((prev) => prev.filter((p) => p.projectId !== projectId));
      setDeletingId(null);
    } catch {
      setDeleteError(true);
    } finally {
      setDeleteBusy(false);
    }
  }

  // 名前変更：編集中のプロジェクトID・入力値・操作中・失敗表示。
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState(false);

  function startRename(p: ProjectSummary) {
    setRenamingId(p.projectId);
    setRenameValue(p.projectName || "");
    setRenameError(false);
  }

  async function saveRename(projectId: string) {
    const name = renameValue.trim();
    if (!name || renameBusy) return;
    setRenameBusy(true);
    setRenameError(false);
    try {
      await renameProject(projectId, name);
    } catch {
      setRenameError(true);
      return; // リネーム自体が失敗したときだけエラー表示（入力欄は残して再試行可能に）。
    } finally {
      setRenameBusy(false);
    }
    // リネーム成功。入力欄を閉じ、一覧を最新化する。一覧の再取得失敗はリネーム完了に影響しないのでサイレント。
    setRenamingId(null);
    try {
      setProjects(await listProjects());
    } catch {
      /* 一覧の再取得失敗は無視（リネーム自体は済んでいる＝誤った失敗表示・二重実行を防ぐ） */
    }
  }

  useEffect(() => {
    let alive = true;
    listProjects()
      .then((list) => {
        if (alive) setProjects(list);
      })
      .catch(() => {
        /* 一覧の取得に失敗しても画面は表示する */
      });
    return () => {
      alive = false;
    };
  }, [listProjects]);

  async function openProject(projectId: string) {
    if (isExporting) return; // 書き出し中は切替をブロック（loadProject は no-op・遷移もしない・#379）
    setOpenError(false);
    try {
      await loadProject(projectId);
      onNavigate("draft");
    } catch {
      setOpenError(true);
    }
  }

  return (
    <div className="main-scroll">
      <div className="content-with-yuko">
        <div>
          {openError && (
            <div className="notice notice-warn mb" role="alert">
              <span>プロジェクトを開けませんでした。一覧から別のプロジェクトを選んでください。</span>
            </div>
          )}

          {deleteError && (
            <div className="notice notice-warn mb" role="alert">
              <span>プロジェクトを削除できませんでした。もう一度お試しください。</span>
            </div>
          )}

          {renameError && (
            <div className="notice notice-warn mb" role="alert">
              <span>名前を変更できませんでした。もう一度お試しください。</span>
            </div>
          )}

          {isExporting && (
            <div className="notice notice-info mb" role="status">
              <span>
                動画の書き出し中です。終わるまで、新しい動画づくり・プロジェクトの切り替え・削除はできません（完了までお待ちください）。
              </span>
            </div>
          )}

          {confirmNew && (
            <div className="notice notice-warn mb" role="alert">
              <span>
                今の編集内容を閉じて新しく作りますか？保存していない素材や場面は失われます（保存済みのプロジェクトは下の一覧からいつでも開けます）。
              </span>
              <div className="row gap-sm">
                <button className="btn btn-primary btn-icon" onClick={confirmStartNew}>
                  新しく作る
                </button>
                <button className="btn btn-ghost btn-icon" onClick={cancelNew}>
                  やめる
                </button>
              </div>
            </div>
          )}

          {/* ヒーロー: 新しい動画を作る */}
          <div className="hero">
            <div>
              <div className="badge badge-teal mb">動画づくり支援</div>
              <h1 className="page-title text-balance">
                伝えたいことを、動画でやさしく届けましょう
              </h1>
              <p className="page-desc text-pretty">
                伝えたい内容と写真・動画を入れると、ゆうこが動画のたたき台を作ります。
                内容を確認・修正してから、動画として保存できます。
              </p>
              <div className="row gap-sm mt" style={{ flexWrap: "wrap" }}>
                <button className="btn btn-primary btn-lg" onClick={startNew} disabled={isExporting} title={isExporting ? "書き出しが終わるまでお待ちください" : undefined}>
                  <PlusIcon size={20} />
                  新しい動画を作る
                </button>
                {/* 白紙から作る（#393）＝ウィザード/AI を通らず、空のたたき台から自分で場面を組み立てる。 */}
                <button className="btn btn-secondary btn-lg" onClick={startBlank} disabled={isExporting} title={isExporting ? "書き出しが終わるまでお待ちください" : "AI を使わず、自分で場面を組み立てます"}>
                  白紙から作る
                </button>
              </div>
            </div>
            <div
              className="thumb thumb-video"
              style={{ width: 220, flexShrink: 0 }}
              aria-hidden="true"
            >
              <FilmIcon size={40} />
            </div>
          </div>

          {/* クイック操作 */}
          <div className="card-grid cols-3 mb">
            <button className="action-card" onClick={startNew} disabled={isExporting} title={isExporting ? "書き出しが終わるまでお待ちください" : undefined}>
              <div
                className="action-card-icon"
                style={{ background: "var(--color-primary-soft)", color: "var(--color-primary)" }}
              >
                <PlusIcon size={24} />
              </div>
              <span className="action-card-title">新しい動画を作る</span>
              <span className="action-card-desc">
                5つのステップで、動画のたたき台を作ります。
              </span>
            </button>

            <button className="action-card" onClick={() => onNavigate("looks")}>
              <div
                className="action-card-icon"
                style={{ background: "var(--color-accent-soft)", color: "var(--color-accent)" }}
              >
                <LayoutIcon size={24} />
              </div>
              <span className="action-card-title">見た目パターンを管理</span>
              <span className="action-card-desc">
                動画の見た目のパターンを確認・追加します。
              </span>
            </button>

            <button className="action-card" onClick={() => onNavigate("settings")}>
              <div
                className="action-card-icon"
                style={{ background: "var(--color-yellow)", color: "#8a6d1a" }}
              >
                <SettingsIcon size={24} />
              </div>
              <span className="action-card-title">設定</span>
              <span className="action-card-desc">
                使用するAIや読み上げの声、保存先を設定します。
              </span>
            </button>
          </div>

          {/* 最近のプロジェクト（この画面自体が一覧なので「すべて見る」導線は置かない・#399 レビュー）。 */}
          <h2 className="section-title mb">最近のプロジェクト</h2>
          <div className="col gap-sm">
            {projects.length === 0 ? (
              <div className="text-sm text-muted">
                保存したプロジェクトはまだありません。「新しい動画を作る」から始めましょう。
              </div>
            ) : (
              projects.map((p) =>
                renamingId === p.projectId ? (
                  <div key={p.projectId} className="list-item">
                    <input
                      className="input grow"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      maxLength={PROJECT_NAME_MAX_LENGTH}
                      placeholder="プロジェクト名"
                      aria-label="プロジェクト名"
                      autoFocus
                      onKeyDown={(e) => {
                        // IME 変換確定の Enter では保存しない（日本語入力中の誤確定を防ぐ）。
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) void saveRename(p.projectId);
                        if (e.key === "Escape") {
                          setRenamingId(null);
                          setRenameError(false);
                        }
                      }}
                    />
                    <button
                      className="btn btn-primary btn-icon"
                      disabled={renameBusy || !renameValue.trim()}
                      onClick={() => void saveRename(p.projectId)}
                    >
                      {renameBusy ? "保存中…" : "保存"}
                    </button>
                    <button
                      className="btn btn-ghost btn-icon"
                      disabled={renameBusy}
                      onClick={() => {
                        setRenamingId(null);
                        setRenameError(false);
                      }}
                    >
                      やめる
                    </button>
                  </div>
                ) : deletingId === p.projectId ? (
                  <DeleteConfirm
                    key={p.projectId}
                    busy={deleteBusy}
                    message={`「${p.projectName || "無題のプロジェクト"}」を削除しますか？保存した場面・素材・音声ごと消え、元に戻せません。`}
                    onCancel={() => {
                      setDeletingId(null);
                      setDeleteError(false);
                    }}
                    onConfirm={() => void removeProject(p.projectId)}
                  />
                ) : (
                  <div key={p.projectId} className="list-item">
                    <button
                      className="row gap-sm grow"
                      onClick={() => void openProject(p.projectId)}
                      disabled={isExporting}
                      title={isExporting ? "書き出しが終わるまでお待ちください" : undefined}
                      style={{ background: "transparent", border: "none", padding: 0, cursor: isExporting ? "not-allowed" : "pointer", textAlign: "left" }}
                    >
                      <div
                        className="thumb thumb-photo"
                        style={{ width: 96, flexShrink: 0 }}
                        aria-hidden="true"
                      >
                        <FolderIcon size={24} />
                      </div>
                      <div className="grow">
                        <div className="row gap-sm">
                          <strong>{p.projectName || "無題のプロジェクト"}</strong>
                        </div>
                        <div className="text-sm text-muted">
                          更新日 {formatDate(p.updatedAt)}
                        </div>
                      </div>
                      <ChevronRightIcon size={20} className="text-faint" />
                    </button>
                    <button
                      className="btn btn-ghost btn-icon"
                      onClick={() => startRename(p)}
                      aria-label={`「${p.projectName || "無題のプロジェクト"}」の名前を変更`}
                      title="名前を変更"
                    >
                      <PencilIcon size={18} />
                    </button>
                    <button
                      className="btn btn-ghost btn-icon"
                      disabled={isExporting}
                      onClick={() => {
                        setDeletingId(p.projectId);
                        setDeleteError(false);
                      }}
                      aria-label={`「${p.projectName || "無題のプロジェクト"}」を削除`}
                      title={isExporting ? "書き出しが終わるまでお待ちください" : "削除"}
                    >
                      <TrashIcon size={18} />
                    </button>
                  </div>
                ),
              )
            )}
          </div>
        </div>

        <YukoPanel
          messages={[
            "こんにちは、ゆうこです。今日も動画づくりをお手伝いします。",
            "まずは「新しい動画を作る」から始めてみましょう。伝えたい内容と写真があれば大丈夫です。",
            "前に作ったプロジェクトは、下の一覧からいつでも開けますよ。",
          ]}
        />
      </div>
    </div>
  );
}

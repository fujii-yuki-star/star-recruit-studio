import { useEffect, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import type { ProjectSummary } from "../../infrastructure/projectFs";
import { useStartNewProject } from "../hooks/useStartNewProject";
import { YukoPanel } from "../components/YukoPanel";
import {
  PlusIcon,
  LayoutIcon,
  SettingsIcon,
  FilmIcon,
  ChevronRightIcon,
  FolderIcon,
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
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  // 「新しい動画を作る」はヘッダと同じ破棄ガード付きフロー（共有フックで挙動統一）。
  const { confirming: confirmNew, start: startNew, confirm: confirmStartNew, cancel: cancelNew } =
    useStartNewProject(onNavigate);
  // プロジェクトを開けなかったときのユーザー向け表示（§2-5）。
  const [openError, setOpenError] = useState(false);

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
              <div className="badge badge-teal mb">採用動画づくり支援</div>
              <h1 className="page-title text-balance">
                会社の魅力を、動画でやさしく伝えましょう
              </h1>
              <p className="page-desc text-pretty">
                会社情報と写真・動画を入れると、ゆうこが動画のたたき台を作ります。
                内容を確認・修正してから、動画として保存できます。
              </p>
              <button className="btn btn-primary btn-lg mt" onClick={startNew}>
                <PlusIcon size={20} />
                新しい動画を作る
              </button>
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
            <button className="action-card" onClick={startNew}>
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

          {/* 最近のプロジェクト */}
          <div className="row-between mb">
            <h2 className="section-title" style={{ margin: 0 }}>
              最近のプロジェクト
            </h2>
            <button className="btn btn-ghost" onClick={() => onNavigate("draft")}>
              すべて見る
              <ChevronRightIcon size={16} />
            </button>
          </div>
          <div className="col gap-sm">
            {projects.length === 0 ? (
              <div className="text-sm text-muted">
                保存したプロジェクトはまだありません。「新しい動画を作る」から始めましょう。
              </div>
            ) : (
              projects.map((p) => (
                <button
                  key={p.projectId}
                  className="list-item"
                  onClick={() => void openProject(p.projectId)}
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
              ))
            )}
          </div>
        </div>

        <YukoPanel
          messages={[
            "こんにちは、ゆうこです。今日も採用動画づくりをお手伝いします。",
            "まずは「新しい動画を作る」から始めてみましょう。会社情報と写真があれば大丈夫です。",
            "前に作ったプロジェクトは、下の一覧からいつでも開けますよ。",
          ]}
        />
      </div>
    </div>
  );
}

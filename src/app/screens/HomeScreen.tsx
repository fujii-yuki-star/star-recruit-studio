import type { ScreenId } from "../data/mockData";
import { recentProjects } from "../data/mockData";
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

export function HomeScreen({ onNavigate }: HomeProps) {
  return (
    <div className="main-scroll">
      <div className="content-with-yuko">
        <div>
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
              <button
                className="btn btn-primary btn-lg mt"
                onClick={() => onNavigate("wizard")}
              >
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
            <button className="action-card" onClick={() => onNavigate("wizard")}>
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
                使用するAIやゆうこの声、保存先を設定します。
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
            {recentProjects.map((p) => (
              <button
                key={p.id}
                className="list-item"
                onClick={() => onNavigate("draft")}
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
                    <strong>{p.name}</strong>
                    <span className="badge badge-gray">{p.purpose}</span>
                  </div>
                  <div className="text-sm text-muted">
                    更新日 {p.updatedAt}　/　場面 {p.sceneCount}個　/　{p.durationLabel}
                  </div>
                </div>
                <ChevronRightIcon size={20} className="text-faint" />
              </button>
            ))}
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

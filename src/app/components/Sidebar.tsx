import type { ScreenId } from "../data/mockData";
import {
  FolderIcon,
  FilmIcon,
  PhotoIcon,
  LayoutIcon,
  SettingsIcon,
  HelpIcon,
  MailIcon,
  BellIcon,
} from "./icons";

interface SidebarProps {
  current: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  /** 開いている動画の名前（「今の動画（名前）」に出す・#252 合流）。 */
  projectName: string;
  /** 動画を開いているか（生成済み/生成中/場面あり）。開いている間だけ「今の動画」を出す。 */
  hasProjectContent: boolean;
}

// 動画づくりの工程画面群（サイドバーの「今の動画」で束ねる＝#399 B案）。
const projectScreens: ScreenId[] = [
  "wizard",
  "confirm",
  "generating",
  "draft",
  "scene-edit",
  "preview",
  "timeline",
  "timeline-edit",
  "precheck",
  "export",
];

// 先頭「プロジェクト」＝一覧（現ホームを統合）＋素材/見た目/設定。「今の動画」は工程画面群を束ねる別項目で条件表示（#399 B案）。
const mainMenu: { id: ScreenId; label: string; icon: typeof FolderIcon }[] = [
  { id: "home", label: "プロジェクト", icon: FolderIcon },
  { id: "materials", label: "素材", icon: PhotoIcon },
  { id: "looks", label: "見た目パターン", icon: LayoutIcon },
  { id: "settings", label: "設定", icon: SettingsIcon },
];

export function Sidebar({ current, onNavigate, projectName, hasProjectContent }: SidebarProps) {
  // 「プロジェクト」（一覧）は一覧画面でのみ active。工程画面は「今の動画」を active にする。
  const isActive = (id: ScreenId): boolean => current === id;
  const currentIsProject = projectScreens.includes(current);
  // 動画を開いている、または今まさに工程画面にいるときだけ「今の動画」を出す（未オープン時は出さない＝一覧へ誘導）。
  const showCurrentProject = hasProjectContent || currentIsProject;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        {/* ロゴマークはナレーター「ゆうこ」の頭文字＝マスコット表示。製品名（すたりお）とは別物なので据え置く（ADR-0011）。 */}
        <div className="sidebar-brand-mark">ゆ</div>
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-title">すたりお</span>
          <span className="sidebar-brand-sub">動画づくり支援ソフト</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="メインメニュー">
        {/* 先頭＝プロジェクト（一覧） */}
        <button
          className={`nav-item${isActive("home") ? " active" : ""}`}
          onClick={() => onNavigate("home")}
          aria-current={isActive("home") ? "page" : undefined}
        >
          <FolderIcon size={20} className="nav-icon" />
          プロジェクト
        </button>

        {/* 今の動画（開いている間だけ・工程画面群を束ねる）。押すとたたき台へ。名前も出す（#252 合流）。 */}
        {showCurrentProject && (
          <button
            className={`nav-item${currentIsProject ? " active" : ""}`}
            onClick={() => onNavigate("draft")}
            aria-current={currentIsProject ? "page" : undefined}
            title={`今の動画：${projectName}`}
          >
            <FilmIcon size={20} className="nav-icon" />
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0, lineHeight: 1.25 }}>
              <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.7 }}>今の動画</span>
              <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {projectName}
              </span>
            </span>
          </button>
        )}

        {mainMenu.slice(1).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`nav-item${isActive(item.id) ? " active" : ""}`}
              onClick={() => onNavigate(item.id)}
              aria-current={isActive(item.id) ? "page" : undefined}
            >
              <Icon size={20} className="nav-icon" />
              {item.label}
            </button>
          );
        })}
        <button className="nav-item" disabled title="準備中です">
          <HelpIcon size={20} className="nav-icon" />
          ヘルプ
          <span className="text-faint text-sm" style={{ marginLeft: "auto" }}>準備中</span>
        </button>
      </nav>

      <div className="sidebar-footer">
        <button
          className={`nav-item${current === "about" ? " active" : ""}`}
          onClick={() => onNavigate("about")}
          aria-current={current === "about" ? "page" : undefined}
        >
          <HelpIcon size={18} className="nav-icon" />
          このアプリについて
        </button>
        <button className="nav-item" disabled title="準備中です">
          <MailIcon size={18} className="nav-icon" />
          お問い合わせ
          <span className="text-faint text-sm" style={{ marginLeft: "auto" }}>準備中</span>
        </button>
        <button className="nav-item" disabled title="準備中です">
          <BellIcon size={18} className="nav-icon" />
          お知らせ
          <span className="text-faint text-sm" style={{ marginLeft: "auto" }}>準備中</span>
        </button>
      </div>
    </aside>
  );
}

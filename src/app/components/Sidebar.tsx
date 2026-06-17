import type { ScreenId } from "../data/mockData";
import {
  HomeIcon,
  FolderIcon,
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
}

const mainMenu: { id: ScreenId; label: string; icon: typeof HomeIcon }[] = [
  { id: "home", label: "ホーム", icon: HomeIcon },
  { id: "draft", label: "プロジェクト", icon: FolderIcon },
  { id: "materials", label: "素材", icon: PhotoIcon },
  { id: "looks", label: "見た目パターン", icon: LayoutIcon },
  { id: "settings", label: "設定", icon: SettingsIcon },
];

export function Sidebar({ current, onNavigate }: SidebarProps) {
  // プロジェクト系の画面はサイドバーの「プロジェクト」をアクティブにする
  const projectScreens: ScreenId[] = [
    "wizard",
    "confirm",
    "generating",
    "draft",
    "scene-edit",
    "preview",
    "precheck",
    "export",
  ];

  function isActive(id: ScreenId) {
    if (id === "draft") return projectScreens.includes(current);
    return current === id;
  }

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
        {mainMenu.map((item) => {
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
        <button
          className="nav-item"
          onClick={() => onNavigate("home")}
        >
          <HelpIcon size={20} className="nav-icon" />
          ヘルプ
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
        <button className="nav-item">
          <MailIcon size={18} className="nav-icon" />
          お問い合わせ
        </button>
        <button className="nav-item">
          <BellIcon size={18} className="nav-icon" />
          お知らせ
        </button>
      </div>
    </aside>
  );
}

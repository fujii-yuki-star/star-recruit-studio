import type { ScreenId } from "../data/mockData";
import { HOME_SCREEN_LABEL } from "../uiLabels";
import { isProjectScreen } from "../navigation";
import {
  FolderIcon,
  FilmIcon,
  PhotoIcon,
  LayoutIcon,
  SettingsIcon,
  HelpIcon,
  InfoIcon,
  ChevronRightIcon,
} from "./icons";
import { yukoImage } from "../data/yukoImages";
import { SCREEN_TITLES } from "../screenTitles";

interface SidebarProps {
  current: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  /**
   * 開いている動画（「今の動画」に出すもの）。**開いている形式のぶんだけ並ぶ**（#1006）。
   *
   * ⚠️ **1つに畳まない**＝2つの形式は同時に開いたままが正規の状態なので、
   * 直近にいた方だけを出すと**もう片方へサイドバーから戻れない**（一覧を経由するしかない）。
   * 決め方は `navigation.ts` の `currentProjectEntries` に1つだけ置く（画面で書かない）。
   */
  currentProjects: { kind: "scene" | "timeline"; name: string; target: ScreenId; sub: string }[];
  /**
   * 帯を畳む（#1103）。
   *
   * ⚠️ **畳んだら完全に隠す**（利用者決定 2026-09-10）＝隠したあとに戻す取っ手を出すのは
   * 親（`App`）の仕事。ここは「畳んでほしい」と伝えるだけ。
   */
  onCollapse: () => void;
}

// 先頭「動画」＝一覧（現ホームを統合）＋素材/見た目/設定。
// ⚠️ **「プロジェクト」から改名**（#1026・利用者判断 2026-09-10）＝同じ場所を、左は「プロジェクト」、
// タイムライン画面の右上は「動画の一覧へ」と**2つの言葉で呼んでいた**（実機で確認）。
// 利用者は人事・非エンジニアなので、作るものの名前（動画）で呼ぶ。「今の動画」は工程画面群を束ねる別項目で条件表示（#399 B案）。
const mainMenu: { id: ScreenId; label: string; icon: typeof FolderIcon }[] = [
  { id: "materials", label: "素材", icon: PhotoIcon },
  { id: "looks", label: "見た目パターン", icon: LayoutIcon },
  { id: "settings", label: "設定", icon: SettingsIcon },
];

export function Sidebar({ current, onNavigate, currentProjects, onCollapse }: SidebarProps) {
  // 「プロジェクト」（一覧）は一覧画面でのみ active。工程画面は「今の動画」を active にする。
  // 「見た目パターン」は一覧(looks)＋編集(looks-edit)を束ねて active にする（工程画面群と同じ考え方・#399 レビュー）。
  const isActive = (id: ScreenId): boolean =>
    id === "looks" ? current === "looks" || current === "looks-edit" : current === id;
  const currentIsProject = isProjectScreen(current);

  return (
    <aside className="sidebar" id="app-sidebar">
      <div className="sidebar-brand">
        {/* ロゴマークはナレーター「ゆうこ」＝マスコット表示。製品名（すたりお）とは別物なので据え置く（ADR-0011）。
            ⚠️ **文字の「ゆ」から立ち絵へ**（#1228）＝素材が無い間の仮置きだった。 */}
        <div className="sidebar-brand-mark">
          <img className="sidebar-brand-img" src={yukoImage("smile")} alt="" />
        </div>
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-title">すたりお</span>
          <span className="sidebar-brand-sub">動画づくり支援ソフト</span>
        </div>
        {/* 畳む（#1103）。⚠️ **戻す取っ手は親が出す**＝押した先で行き止まりにしない（ADR-0033 決定6/8）。 */}
        <button
          type="button"
          className="sidebar-collapse"
          onClick={onCollapse}
          aria-label="メニューを畳む"
          aria-expanded
          aria-controls="app-sidebar"
          title="メニューを畳む（作業する場所が広がります）"
        >
          <ChevronRightIcon size={18} style={{ transform: "rotate(180deg)" }} />
        </button>
      </div>

      <nav className="sidebar-nav" aria-label="メインメニュー">
        {/* 先頭＝動画（一覧） */}
        <button
          className={`nav-item${isActive("home") ? " active" : ""}`}
          onClick={() => onNavigate("home")}
          aria-current={isActive("home") ? "page" : undefined}
        >
          <FolderIcon size={20} className="nav-icon" />
          {HOME_SCREEN_LABEL}
        </button>

        {/* 今の動画（開いている間だけ・工程画面群を束ねる）。押すと直近に開いていた工程画面へ戻る（たたき台固定にしない・
            後半工程から押しても居場所を失わない＝#547 P3-7）。名前も出す（#252 合流）。 */}
        {currentProjects.map((p) => {
          // ⚠️ **いま見ている方だけを active にする**＝両方に印が付くと、どちらにいるか分からない。
          const active = p.kind === "timeline" ? current === "timeline-project" : currentIsProject && current !== "timeline-project";
          return (
            <button
              key={p.kind}
              className={`nav-item${active ? " active" : ""}`}
              onClick={() => onNavigate(p.target)}
              aria-current={active ? "page" : undefined}
              title={`${p.sub}：${p.name}`}
            >
              <FilmIcon size={20} className="nav-icon" />
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", minWidth: 0, lineHeight: 1.25 }}>
                <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.7 }}>{p.sub}</span>
                <span style={{ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </span>
              </span>
            </button>
          );
        })}

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
        {/* 使い方（#1229・ADR-0046 ①）。
            ⚠️ **「準備中」で置いていた**＝押せない項目が帯に3つ並び、**使い方を伝える手段が無かった**。
            ⚠️ **名前は画面と同じものを引く**＝ここで書き写すと、画面名を変えたとき帯だけ古くなる（#1026 の再来）。 */}
        <button
          className={`nav-item${isActive("help") ? " active" : ""}`}
          onClick={() => onNavigate("help")}
          aria-current={isActive("help") ? "page" : undefined}
        >
          <HelpIcon size={20} className="nav-icon" />
          {SCREEN_TITLES.help}
        </button>
      </nav>

      <div className="sidebar-footer">
        <button
          className={`nav-item${current === "about" ? " active" : ""}`}
          onClick={() => onNavigate("about")}
          aria-current={current === "about" ? "page" : undefined}
        >
          <InfoIcon size={18} className="nav-icon" />
          {SCREEN_TITLES.about}
        </button>
      </div>
    </aside>
  );
}

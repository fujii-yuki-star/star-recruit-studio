import { useCallback, useEffect, useState } from "react";
import { canNavigate } from "./app/hooks/navigationGuard";
import "./styles/theme.css";
import "./styles/fonts.css";
import type { ScreenId } from "./app/data/mockData";
import { isExportBusy, useProjectStore } from "./app/store/projectStore";
import { getLastProjectId } from "./infrastructure/projectFs";
import { Sidebar } from "./app/components/Sidebar";
import { SaveStatusBadge } from "./app/components/SaveStatusBadge";
import { ExportResultNotice } from "./app/components/ExportResultNotice";
import { saveButtonLabel } from "./app/components/saveButtonLabel";
import { useStartNewProject } from "./app/hooks/useStartNewProject";
import { useAutoSave } from "./app/hooks/useAutoSave";
import { isUndoRedoEnabledFor, useUndoRedoShortcuts } from "./app/hooks/useUndoRedoShortcuts";
import { DEFAULT_PROJECT_RETURN, stickyProjectScreen } from "./app/navigation";
import { HomeScreen } from "./app/screens/HomeScreen";
import { WizardScreen } from "./app/screens/WizardScreen";
import { ConfirmScreen } from "./app/screens/ConfirmScreen";
import { GeneratingScreen } from "./app/screens/GeneratingScreen";
import { DraftScreen } from "./app/screens/DraftScreen";
import { SceneEditScreen } from "./app/screens/SceneEditScreen";
import { PreviewScreen } from "./app/screens/PreviewScreen";
import { TimelineScreen } from "./app/screens/TimelineScreen";
import { TimelineProjectScreen } from "./app/screens/TimelineProjectScreen";
import { PrecheckScreen } from "./app/screens/PrecheckScreen";
import { ExportScreen } from "./app/screens/ExportScreen";
import { LooksScreen } from "./app/screens/LooksScreen";
import { LooksEditScreen } from "./app/screens/LooksEditScreen";
import { MaterialsScreen } from "./app/screens/MaterialsScreen";
import { SettingsScreen } from "./app/screens/SettingsScreen";
import { AboutScreen } from "./app/screens/AboutScreen";

const titles: Record<ScreenId, string> = {
  home: "プロジェクト", // サイドバー先頭「プロジェクト」＝一覧（現ホーム統合・#399 B案）。名前と画面を一致させる。
  wizard: "新しい動画を作る",
  confirm: "動画案を作る前の確認",
  generating: "動画案を作成中",
  draft: "動画のたたき台を確認",
  "scene-edit": "場面編集",
  preview: "仕上がり確認",
  timeline: "タイムライン",
  "timeline-project": "タイムライン編集",
  precheck: "公開前チェック",
  export: "動画を書き出す",
  looks: "見た目パターンを管理",
  "looks-edit": "見た目パターンを編集",
  materials: "素材を管理",
  settings: "設定",
  about: "このアプリについて",
};

function App() {
  const [screen, setScreen] = useState<ScreenId>("home");
  // 「今の動画」の戻り先＝直近に開いていた工程画面（#547 P3-7）。工程画面にいる間はそこを覚え、工程外
  // （素材・設定・一覧）へ出ても位置を保持する＝押すとたたき台固定で先頭へ飛ばされず、居場所に戻れる。
  const [projectReturnTo, setProjectReturnTo] = useState<ScreenId>(DEFAULT_PROJECT_RETURN);
  // 画面遷移は必ずこの navigate を通す（直接 setScreen を配らない）＝遷移のたびに戻り先を同時更新する。
  // effect で screen を後追いすると setState 連鎖になる（React の警告）ため、遷移時に1回で確定する（純粋関数で判定）。
  const navigate = useCallback((next: ScreenId) => {
    // 離れる前に聞きたい画面があれば、ここで一度だけ聞く（#719）。断られたら**遷移しない**
    // ＝確認を出すのは断った側の責任（黙って止めない・§2-5）。サイドバーもこの入口を通るので、
    // 画面内のボタンだけに確認が付いていて素通しできる、という穴が構造的に塞がる。
    if (!canNavigate(next)) return;
    setProjectReturnTo((prev) => stickyProjectScreen(prev, next));
    setScreen(next);
  }, []);
  const saveProject = useProjectStore((s) => s.saveProject);
  const saveStatus = useProjectStore((s) => s.saveStatus);
  // 書き出し中はヘッダの新規作成を無効化（切替で進行中の書き出しデータが壊れるのを防ぐ・#379）。
  // phase を選び、Undo/Redo 結線（下の isUndoRedoEnabledFor）と新規作成無効化の両方の元にする。
  const exportPhase = useProjectStore((s) => s.exportRun.phase);
  const isExporting = isExportBusy(exportPhase);
  const loadProject = useProjectStore((s) => s.loadProject);
  const loadUserTemplates = useProjectStore((s) => s.loadUserTemplates);
  const refreshUserFonts = useProjectStore((s) => s.refreshUserFonts);
  // サイドバー「今の動画（名前）」用（#399 B案・#252 合流）：動画を開いている間だけ出し、名前を表示する。
  const hasProjectContent = useProjectStore((s) => s.status !== "idle" || s.scenes.length > 0);
  const projectName = useProjectStore((s) => s.meta.projectName);
  // 「新しい動画を作る」はホームと同じ破棄ガード付きフローに統一する。
  const { confirming: confirmNew, start: startNewProject, confirm: confirmNewProject, cancel: cancelNewProject } =
    useStartNewProject(navigate);
  // 編集が落ち着いたら自動でバックグラウンド保存（#256）。App は常時マウント＝全画面で有効。
  useAutoSave();
  // Undo/Redo のキーボード（Ctrl/⌘+Z・Y）。App 一箇所に集約＝画面ごとの二重登録（二重 Undo）を防ぐ（#413）。
  // 有効にするのは「取り消す/やり直す」UI がある画面だけ（UNDO_REDO_SCREENS＝たたき台/場面編集/タイムライン編集）。
  // 全画面で有効にすると、テンプレ作成のように編集が画面ローカルの画面で Ctrl+Z が画面外の編集を無言で巻き戻し、
  // 自動保存が永続化してしまう（#547 P1-1・データ喪失・ADR-0020「入口」）。#413 の「たたき台でも Ctrl+Z」は draft を含めて満たす。
  // 書き出し中は undo/redo を無効化（ボタンは inert で操作不可なのに Ctrl+Z だけ無言 no-op になる不整合を防ぐ・#570 P2 レビュー）。
  // 結線式は共有述語に集約＝回帰テストと同じシンボルを参照し、ここのドリフトを1箇所で検知する。
  useUndoRedoShortcuts(isUndoRedoEnabledFor(screen, exportPhase));

  // 起動時に最後のプロジェクトを自動で開く（保存済みデータを復元。失敗時は新規状態のまま）。
  // あわせてグローバルのユーザーテンプレ（ADR-0017）を読み込み、見た目パターン一覧へマージする。
  useEffect(() => {
    const last = getLastProjectId();
    if (last) void loadProject(last).catch(() => {});
    void loadUserTemplates().catch(() => {});
    // ⚠️ **持ち込みフォントは起動時に1回そろえる**（α-6 出口監査 🟡11）＝`loadUserFonts` の入口が
    // 設定・公開前チェック・書き出しにしか無かったため、**場面編集・仕上がり確認・タイムライン編集では
    // プレビューだけ既定の字体**になっていた（書き出しは実物＝ADR-0001 のパリティが崩れる）。
    // 画面ごとに数え上げると必ず漏れるので、**文書より上の起点で1回**通す。
    void refreshUserFonts().catch(() => {});
  }, [loadProject, loadUserTemplates, refreshUserFonts]);

  // サイドバー等で画面が切り替わったら、出しっぱなしの確認バナーを閉じる。
  useEffect(() => {
    cancelNewProject();
  }, [screen, cancelNewProject]);

  const saveLabel = saveButtonLabel(saveStatus);

  function renderScreen() {
    switch (screen) {
      case "home":
        return <HomeScreen onNavigate={navigate} />;
      case "wizard":
        return <WizardScreen onNavigate={navigate} />;
      case "confirm":
        return <ConfirmScreen onNavigate={navigate} />;
      case "generating":
        return <GeneratingScreen onNavigate={navigate} />;
      case "draft":
        return <DraftScreen onNavigate={navigate} />;
      case "scene-edit":
        return <SceneEditScreen onNavigate={navigate} />;
      case "preview":
        return <PreviewScreen onNavigate={navigate} />;
      case "timeline":
        return <TimelineScreen onNavigate={navigate} />;
            case "timeline-project":
        return <TimelineProjectScreen onNavigate={navigate} />;
      case "precheck":
        return <PrecheckScreen onNavigate={navigate} />;
      case "export":
        return <ExportScreen onNavigate={navigate} />;
      case "looks":
        return <LooksScreen onNavigate={navigate} />;
      case "looks-edit":
        return <LooksEditScreen onNavigate={navigate} />;
      case "materials":
        return <MaterialsScreen onNavigate={navigate} />;
      case "settings":
        return <SettingsScreen onNavigate={navigate} />;
      case "about":
        return <AboutScreen />;
      default:
        return <HomeScreen onNavigate={navigate} />;
    }
  }

  // 場面編集・生成中・見た目パターン編集は独自ヘッダのため、共通トップバー（プロジェクト保存等）は表示しない
  // 共通トップバーの「保存」とバッジは**場面形式の文書**を保存する（projectStore）。タイムライン形式は
  // 別の文書なので出さない＝見ている文書と違うものが保存される／場面文書を開いていないときは空の
  // プロジェクトが新しく作られる、を防ぐ（ADR-0026④）。画面は自前の見出し（PageHead）を持つ。
  const hasOwnHeader =
    screen === "scene-edit" || screen === "generating" || screen === "looks-edit" || screen === "timeline-project";

  return (
    <div className="app">
      <Sidebar current={screen} onNavigate={navigate} projectName={projectName} hasProjectContent={hasProjectContent} currentProjectTarget={projectReturnTo} />
      <div className="main">
        {!hasOwnHeader && (
          <header className="topbar">
            <div className="topbar-title">{titles[screen]}</div>
            <div className="topbar-actions">
              <SaveStatusBadge />
              {/* ウィザードはヘッダ保存を出さない（#401）。ヘッダ保存は applyForm を呼ばず入力を取りこぼす「保存トラップ」
                  になるため、ウィザード自身の「ここまで保存」（applyForm＋saveProject）に一本化する。 */}
              {screen !== "wizard" && (
                <button
                  className="btn btn-ghost"
                  onClick={() => void saveProject()}
                  disabled={saveStatus === "saving"}
                >
                  {saveLabel}
                </button>
              )}
              {/* ホームには専用の大きな導線があるため重複回避でホーム以外に表示。ウィザードは新規作成フロー中なので出さない
                  （未コミットの入力欄を無確認で破棄しうる／同一画面遷移で local state が残る不整合を避ける・#401 レビュー）。 */}
              {screen !== "home" && screen !== "wizard" && (
                <button
                  className="btn btn-secondary"
                  onClick={startNewProject}
                  disabled={isExporting}
                  title={isExporting ? "書き出しが終わるまでお待ちください" : undefined}
                >
                  新しい動画を作る
                </button>
              )}
            </div>
          </header>
        )}
        {!hasOwnHeader && screen !== "home" && confirmNew && (
          <div className="notice notice-warn" role="alert" style={{ margin: "var(--gap)" }}>
            <span>
              今の編集内容を閉じて新しく作りますか？保存していない素材や場面は失われます（保存済みのプロジェクトはプロジェクト一覧からいつでも開けます）。
            </span>
            {/* 確認ダイアログは「やめる（左・ghost）／実行（右）」で全画面統一（#410 sub2・削除確認と同じ並び）。 */}
            <div className="row gap-sm">
              <button className="btn btn-ghost btn-icon" onClick={cancelNewProject}>
                やめる
              </button>
              <button className="btn btn-primary btn-icon" onClick={confirmNewProject}>
                新しく作る
              </button>
            </div>
          </div>
        )}
        {/* 書き出しの終了（成功/失敗/中止）をどの画面にいても知らせる（#589）。**独自ヘッダの画面でも出す**
            （`hasOwnHeader` で囲まない）＝場面編集で待っている利用者にこそ必要。書き出し画面では出さない
            （そこに結果が出ており二重になる）＝開いた時点で既読にする（下の ExportScreen 側で解除）。 */}
        {screen !== "export" && <ExportResultNotice onNavigate={navigate} />}
        {renderScreen()}
      </div>
    </div>
  );
}

export default App;

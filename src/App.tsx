import { useEffect, useState } from "react";
import "./styles/theme.css";
import "./styles/fonts.css";
import type { ScreenId } from "./app/data/mockData";
import { isExportBusy, useProjectStore } from "./app/store/projectStore";
import { getLastProjectId } from "./infrastructure/projectFs";
import { Sidebar } from "./app/components/Sidebar";
import { SaveStatusBadge } from "./app/components/SaveStatusBadge";
import { saveButtonLabel } from "./app/components/saveButtonLabel";
import { useStartNewProject } from "./app/hooks/useStartNewProject";
import { useAutoSave } from "./app/hooks/useAutoSave";
import { UNDO_REDO_SCREENS, useUndoRedoShortcuts } from "./app/hooks/useUndoRedoShortcuts";
import { HomeScreen } from "./app/screens/HomeScreen";
import { WizardScreen } from "./app/screens/WizardScreen";
import { ConfirmScreen } from "./app/screens/ConfirmScreen";
import { GeneratingScreen } from "./app/screens/GeneratingScreen";
import { DraftScreen } from "./app/screens/DraftScreen";
import { SceneEditScreen } from "./app/screens/SceneEditScreen";
import { PreviewScreen } from "./app/screens/PreviewScreen";
import { TimelineScreen } from "./app/screens/TimelineScreen";
import { TimelineEditScreen } from "./app/screens/TimelineEditScreen";
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
  "timeline-edit": "タイムラインを編集",
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
  const saveProject = useProjectStore((s) => s.saveProject);
  const saveStatus = useProjectStore((s) => s.saveStatus);
  // 書き出し中はヘッダの新規作成を無効化（切替で進行中の書き出しデータが壊れるのを防ぐ・#379）。
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase));
  const loadProject = useProjectStore((s) => s.loadProject);
  const loadUserTemplates = useProjectStore((s) => s.loadUserTemplates);
  // サイドバー「今の動画（名前）」用（#399 B案・#252 合流）：動画を開いている間だけ出し、名前を表示する。
  const hasProjectContent = useProjectStore((s) => s.status !== "idle" || s.scenes.length > 0);
  const projectName = useProjectStore((s) => s.meta.projectName);
  // 「新しい動画を作る」はホームと同じ破棄ガード付きフローに統一する。
  const { confirming: confirmNew, start: startNewProject, confirm: confirmNewProject, cancel: cancelNewProject } =
    useStartNewProject(setScreen);
  // 編集が落ち着いたら自動でバックグラウンド保存（#256）。App は常時マウント＝全画面で有効。
  useAutoSave();
  // Undo/Redo のキーボード（Ctrl/⌘+Z・Y）。App 一箇所に集約＝画面ごとの二重登録（二重 Undo）を防ぐ（#413）。
  // 有効にするのは「取り消す/やり直す」UI がある画面だけ（UNDO_REDO_SCREENS＝たたき台/場面編集/タイムライン編集）。
  // 全画面で有効にすると、テンプレ作成のように編集が画面ローカルの画面で Ctrl+Z が画面外の編集を無言で巻き戻し、
  // 自動保存が永続化してしまう（#547 P1-1・データ喪失・ADR-0020「入口」）。#413 の「たたき台でも Ctrl+Z」は draft を含めて満たす。
  useUndoRedoShortcuts(UNDO_REDO_SCREENS.has(screen));

  // 起動時に最後のプロジェクトを自動で開く（保存済みデータを復元。失敗時は新規状態のまま）。
  // あわせてグローバルのユーザーテンプレ（ADR-0017）を読み込み、見た目パターン一覧へマージする。
  useEffect(() => {
    const last = getLastProjectId();
    if (last) void loadProject(last).catch(() => {});
    void loadUserTemplates().catch(() => {});
  }, [loadProject, loadUserTemplates]);

  // サイドバー等で画面が切り替わったら、出しっぱなしの確認バナーを閉じる。
  useEffect(() => {
    cancelNewProject();
  }, [screen, cancelNewProject]);

  const saveLabel = saveButtonLabel(saveStatus);

  function renderScreen() {
    switch (screen) {
      case "home":
        return <HomeScreen onNavigate={setScreen} />;
      case "wizard":
        return <WizardScreen onNavigate={setScreen} />;
      case "confirm":
        return <ConfirmScreen onNavigate={setScreen} />;
      case "generating":
        return <GeneratingScreen onNavigate={setScreen} />;
      case "draft":
        return <DraftScreen onNavigate={setScreen} />;
      case "scene-edit":
        return <SceneEditScreen onNavigate={setScreen} />;
      case "preview":
        return <PreviewScreen onNavigate={setScreen} />;
      case "timeline":
        return <TimelineScreen onNavigate={setScreen} />;
      case "timeline-edit":
        return <TimelineEditScreen onNavigate={setScreen} />;
      case "precheck":
        return <PrecheckScreen onNavigate={setScreen} />;
      case "export":
        return <ExportScreen onNavigate={setScreen} />;
      case "looks":
        return <LooksScreen onNavigate={setScreen} />;
      case "looks-edit":
        return <LooksEditScreen onNavigate={setScreen} />;
      case "materials":
        return <MaterialsScreen onNavigate={setScreen} />;
      case "settings":
        return <SettingsScreen />;
      case "about":
        return <AboutScreen />;
      default:
        return <HomeScreen onNavigate={setScreen} />;
    }
  }

  // 場面編集・生成中・見た目パターン編集は独自ヘッダのため、共通トップバー（プロジェクト保存等）は表示しない
  const hasOwnHeader = screen === "scene-edit" || screen === "generating" || screen === "looks-edit";

  return (
    <div className="app">
      <Sidebar current={screen} onNavigate={setScreen} projectName={projectName} hasProjectContent={hasProjectContent} />
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
        {renderScreen()}
      </div>
    </div>
  );
}

export default App;

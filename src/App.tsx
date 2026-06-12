import { useState } from "react";
import "./styles/theme.css";
import type { ScreenId } from "./app/data/mockData";
import { useProjectStore } from "./app/store/projectStore";
import { Sidebar } from "./app/components/Sidebar";
import { HomeScreen } from "./app/screens/HomeScreen";
import { WizardScreen } from "./app/screens/WizardScreen";
import { ConfirmScreen } from "./app/screens/ConfirmScreen";
import { GeneratingScreen } from "./app/screens/GeneratingScreen";
import { DraftScreen } from "./app/screens/DraftScreen";
import { SceneEditScreen } from "./app/screens/SceneEditScreen";
import { PreviewScreen } from "./app/screens/PreviewScreen";
import { PrecheckScreen } from "./app/screens/PrecheckScreen";
import { ExportScreen } from "./app/screens/ExportScreen";
import { LooksScreen } from "./app/screens/LooksScreen";
import { MaterialsScreen } from "./app/screens/MaterialsScreen";
import { SettingsScreen } from "./app/screens/SettingsScreen";
import { AboutScreen } from "./app/screens/AboutScreen";

const titles: Record<ScreenId, string> = {
  home: "ホーム",
  wizard: "新しい動画を作る",
  confirm: "動画案を作る前の確認",
  generating: "動画案を作成中",
  draft: "動画のたたき台を確認",
  "scene-edit": "場面編集",
  preview: "仕上がり確認",
  precheck: "公開前チェック",
  export: "動画を書き出す",
  looks: "見た目パターンを管理",
  materials: "素材を管理",
  settings: "設定",
  about: "このアプリについて",
};

function App() {
  const [screen, setScreen] = useState<ScreenId>("home");
  const saveProject = useProjectStore((s) => s.saveProject);
  const saveStatus = useProjectStore((s) => s.saveStatus);

  const saveLabel =
    saveStatus === "saving" ? "保存中…" : saveStatus === "saved" ? "保存しました" : "保存";

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
      case "precheck":
        return <PrecheckScreen onNavigate={setScreen} />;
      case "export":
        return <ExportScreen onNavigate={setScreen} />;
      case "looks":
        return <LooksScreen />;
      case "materials":
        return <MaterialsScreen />;
      case "settings":
        return <SettingsScreen />;
      case "about":
        return <AboutScreen />;
      default:
        return <HomeScreen onNavigate={setScreen} />;
    }
  }

  // 場面編集と生成中は独自レイアウトのため、共通トップバーは表示しない
  const hasOwnHeader = screen === "scene-edit" || screen === "generating";

  return (
    <div className="app">
      <Sidebar current={screen} onNavigate={setScreen} />
      <div className="main">
        {!hasOwnHeader && (
          <header className="topbar">
            <div className="topbar-title">{titles[screen]}</div>
            <div className="topbar-actions">
              <button
                className="btn btn-ghost"
                onClick={() => void saveProject()}
                disabled={saveStatus === "saving"}
              >
                {saveLabel}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setScreen("wizard")}
              >
                新しい動画を作る
              </button>
            </div>
          </header>
        )}
        {renderScreen()}
      </div>
    </div>
  );
}

export default App;

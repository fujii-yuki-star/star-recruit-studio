import { useState } from "react";
import "./styles/theme.css";
import type { ScreenId } from "./app/data/mockData";
import { Sidebar } from "./app/components/Sidebar";
import { HomeScreen } from "./app/screens/HomeScreen";
import { WizardScreen } from "./app/screens/WizardScreen";
import { ConfirmScreen } from "./app/screens/ConfirmScreen";
import { DraftScreen } from "./app/screens/DraftScreen";
import { SceneEditScreen } from "./app/screens/SceneEditScreen";
import { PreviewScreen } from "./app/screens/PreviewScreen";
import { ExportScreen } from "./app/screens/ExportScreen";
import { LooksScreen } from "./app/screens/LooksScreen";
import { SettingsScreen } from "./app/screens/SettingsScreen";

const titles: Record<ScreenId, string> = {
  home: "ホーム",
  wizard: "新しい動画を作る",
  confirm: "動画案を作る前の確認",
  draft: "動画のたたき台を確認",
  "scene-edit": "場面編集",
  preview: "仕上がり確認",
  export: "動画を書き出す",
  looks: "見た目パターンを管理",
  settings: "設定",
};

function App() {
  const [screen, setScreen] = useState<ScreenId>("home");

  function renderScreen() {
    switch (screen) {
      case "home":
        return <HomeScreen onNavigate={setScreen} />;
      case "wizard":
        return <WizardScreen onNavigate={setScreen} />;
      case "confirm":
        return <ConfirmScreen onNavigate={setScreen} />;
      case "draft":
        return <DraftScreen onNavigate={setScreen} />;
      case "scene-edit":
        return <SceneEditScreen onNavigate={setScreen} />;
      case "preview":
        return <PreviewScreen onNavigate={setScreen} />;
      case "export":
        return <ExportScreen onNavigate={setScreen} />;
      case "looks":
        return <LooksScreen />;
      case "settings":
        return <SettingsScreen />;
      default:
        return <HomeScreen onNavigate={setScreen} />;
    }
  }

  // 場面編集は独自のヘッダー帯を持つため、共通トップバーは表示しない
  const hasOwnHeader = screen === "scene-edit";

  return (
    <div className="app">
      <Sidebar current={screen} onNavigate={setScreen} />
      <div className="main">
        {!hasOwnHeader && (
          <header className="topbar">
            <div className="topbar-title">{titles[screen]}</div>
            <div className="topbar-actions">
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

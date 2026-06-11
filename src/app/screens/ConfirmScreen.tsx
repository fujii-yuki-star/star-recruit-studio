import { useState } from "react";
import type { ScreenId } from "../data/mockData";
import { sampleCompany } from "../data/mockData";
import { Switch } from "../components/ui";
import {
  SparkleIcon,
  PhotoIcon,
  VideoIcon,
  CheckIcon,
} from "../components/icons";

interface ConfirmProps {
  onNavigate: (screen: ScreenId) => void;
}

export function ConfirmScreen({ onNavigate }: ConfirmProps) {
  const [showNextTime, setShowNextTime] = useState(true);

  return (
    <div className="main-scroll">
      <div className="modal-overlay" style={{ position: "static", padding: 0 }}>
        <div className="modal" style={{ maxWidth: 680 }}>
          <div className="text-center mb">
            <div
              className="action-card-icon"
              style={{
                background: "var(--color-yellow)",
                color: "#8a6d1a",
                margin: "0 auto var(--gap-sm)",
                width: 56,
                height: 56,
              }}
              aria-hidden="true"
            >
              <SparkleIcon size={28} />
            </div>
            <h1 className="page-title" style={{ fontSize: 20 }}>
              この内容で動画案を作ります
            </h1>
            <p className="page-desc text-pretty">
              下の情報をゆうこに渡して、動画のたたき台を作ります。内容を確認してください。
            </p>
          </div>

          {/* 送信される情報 */}
          <div className="card card-tight mb">
            <h2 className="field-label">ゆうこに渡す情報</h2>
            <div className="col gap-sm mt">
              <div className="row-between">
                <span className="text-muted">会社情報</span>
                <strong>
                  {sampleCompany.companyName}（{sampleCompany.industry}）
                </strong>
              </div>
              <hr className="divider" style={{ margin: "4px 0" }} />
              <div className="row-between">
                <span className="text-muted">動画の目的</span>
                <strong>新卒採用</strong>
              </div>
              <hr className="divider" style={{ margin: "4px 0" }} />
              <div className="row-between">
                <span className="text-muted">素材の説明</span>
                <strong>写真3枚・動画2本</strong>
              </div>
            </div>

            <div className="mt">
              <span className="text-muted text-sm">画像と動画の代表の見え方</span>
              <div className="card-grid cols-4 mt" style={{ gap: 10 }}>
                <div className="thumb thumb-photo">
                  <PhotoIcon size={20} />
                </div>
                <div className="thumb thumb-photo">
                  <PhotoIcon size={20} />
                </div>
                <div className="thumb thumb-photo">
                  <PhotoIcon size={20} />
                </div>
                <div className="thumb thumb-video">
                  <VideoIcon size={20} />
                </div>
              </div>
            </div>
          </div>

          {/* 強調: 元の動画ファイルは送信しません */}
          <div className="notice notice-strong mb">
            <CheckIcon size={18} />
            <span>
              元の動画ファイルは送信しません。動画の内容を伝えるための説明と、
              代表の見え方だけをゆうこに渡します。
            </span>
          </div>

          {/* チェック項目 */}
          <label className="toggle-row" style={{ cursor: "pointer" }}>
            <span className="text-sm">今後もこの確認を表示する</span>
            <Switch on={showNextTime} onChange={setShowNextTime} label="今後もこの確認を表示する" />
          </label>

          {/* ボタン */}
          <div className="row gap-sm mt-lg">
            <button
              className="btn btn-ghost grow"
              onClick={() => onNavigate("wizard")}
            >
              キャンセル
            </button>
            <button
              className="btn btn-primary grow btn-lg"
              onClick={() => onNavigate("draft")}
            >
              <SparkleIcon size={20} />
              送信して動画案を作る
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

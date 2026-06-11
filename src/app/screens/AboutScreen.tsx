import { useState } from "react";
import { PageHead, Switch } from "../components/ui";

const credits = [
  { name: "VOICEVOX：ずんだもん", role: "ゆうこの声（読み上げ）" },
  { name: "FFmpeg (LGPL)", role: "動画の書き出し" },
  { name: "Noto Sans JP", role: "画面・字幕のフォント" },
];

export function AboutScreen() {
  const [withCredit, setWithCredit] = useState(true);

  return (
    <div className="main-scroll">
      <PageHead
        title="このアプリについて"
        desc="Yuko Recruit Studio の情報と、利用しているソフト・素材のクレジットです。"
      />

      <div style={{ maxWidth: 720 }} className="col gap-lg">
        <div className="card">
          <h2 className="section-title">アプリ情報</h2>
          <div className="col gap-sm">
            <div className="row-between">
              <span className="text-muted">名前</span>
              <strong>Yuko Recruit Studio</strong>
            </div>
            <hr className="divider" style={{ margin: "4px 0" }} />
            <div className="row-between">
              <span className="text-muted">バージョン</span>
              <span>0.1.0</span>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="section-title">クレジット</h2>
          <p className="page-desc text-pretty">
            本ソフトは以下を利用しています。動画を公開する際は、これらのクレジット表記にご協力ください。
          </p>
          <div className="col gap-sm mt">
            {credits.map((c) => (
              <div className="list-item" key={c.name} style={{ cursor: "default" }}>
                <div className="grow">
                  <strong>{c.name}</strong>
                  <div className="text-faint text-sm">{c.role}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="toggle-row mt">
            <div>
              <span className="field-label" style={{ margin: 0 }}>
                動画にクレジットを入れる
              </span>
              <p className="field-hint" style={{ marginTop: 2 }}>
                書き出す動画に「VOICEVOX：ずんだもん」などのクレジットを表示します。
              </p>
            </div>
            <Switch on={withCredit} onChange={setWithCredit} label="動画にクレジットを入れる" />
          </div>
        </div>
      </div>
    </div>
  );
}

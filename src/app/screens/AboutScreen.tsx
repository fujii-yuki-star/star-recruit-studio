import { useState } from "react";
import { PageHead, Switch } from "../components/ui";

// クレジット/ライセンス表示（13§9）。FFmpeg は LGPL の義務としてソース入手先も明示する。
const credits: { name: string; role: string; license: string; source?: string }[] = [
  {
    name: "VOICEVOX：ずんだもん",
    role: "ナレーター音声（読み上げ）",
    license: "VOICEVOX 利用規約・東北ずん子／ずんだもんプロジェクト規約（クレジット表示で利用）",
  },
  {
    name: "FFmpeg",
    role: "動画の書き出し",
    license: "LGPL 2.1+",
    source: "ソース入手先: https://www.ffmpeg.org/download.html",
  },
  {
    name: "Noto Sans JP",
    role: "画面・字幕のフォント",
    license: "SIL Open Font License 1.1",
  },
];

export function AboutScreen() {
  const [withCredit, setWithCredit] = useState(true);

  return (
    <div className="main-scroll">
      <PageHead
        title="このアプリについて"
        desc="すたりお（stario）の情報と、利用しているソフト・素材のクレジットです。"
      />

      <div style={{ maxWidth: 720 }} className="col gap-lg">
        <div className="card">
          <h2 className="section-title">アプリ情報</h2>
          <div className="col gap-sm">
            <div className="row-between">
              <span className="text-muted">名前</span>
              <strong>すたりお（stario）</strong>
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
                  <div className="text-faint text-sm">ライセンス: {c.license}</div>
                  {c.source && <div className="text-faint text-sm">{c.source}</div>}
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

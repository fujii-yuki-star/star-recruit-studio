import { useState } from "react";
import { PageHead, Switch } from "../components/ui";
import { openExternalUrl } from "../../infrastructure/opener";
import { OPENH264_CREDIT_TEXT, OPENH264_FEATURE_ENABLED } from "../../domain/export/h264Feature";

// クレジット/ライセンス表示（13§9）。FFmpeg は LGPL の義務としてソース入手先も明示する。
const credits: { name: string; role: string; license: string; credit?: string; source?: { label: string; url: string }; openh264?: boolean }[] = [
  {
    name: "VOICEVOX：ずんだもん",
    role: "ナレーター音声（読み上げ）",
    license: "VOICEVOX 利用規約・東北ずん子／ずんだもんプロジェクト規約（クレジット表示で利用）",
  },
  {
    name: "FFmpeg",
    role: "動画の書き出し",
    license: "LGPL v3（ソースは下記の入手先をご参照ください）",
    source: { label: "FFmpeg ソース入手先", url: "https://ffmpeg.org/releases/" },
  },
  {
    name: "Noto Sans JP",
    role: "画面・字幕のフォント",
    license: "SIL Open Font License 1.1",
  },
  // OpenH264（H.264 動画保存のフォールバック）。主経路は Media Foundation（OS提供）で Cisco クレジット不要＝ADR-0013。OPENH264_FEATURE_ENABLED が true（フォールバック採用）のときだけ表示。
  {
    name: "OpenH264",
    role: "動画の書き出し（予備）",
    credit: OPENH264_CREDIT_TEXT,
    license: "BSD-2-Clause（ソース）／配布バイナリは Cisco の AVC/H.264 Patent Portfolio License",
    source: { label: "提供元・ソース", url: "https://www.openh264.org/" },
    openh264: true,
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
            本ソフトは以下を利用しています。作成した動画を公開・配布する際は、各提供元の利用規約に従い、クレジット表記にご協力ください（特に音声「VOICEVOX：ずんだもん」は、各キャラクターの利用規約とクレジット表記が必要です）。
          </p>
          <div className="col gap-sm mt">
            {credits.filter((c) => OPENH264_FEATURE_ENABLED || !c.openh264).map((c) => {
              const src = c.source;
              return (
                <div className="list-item" key={c.name} style={{ cursor: "default" }}>
                  <div className="grow">
                    <strong>{c.name}</strong>
                    <div className="text-faint text-sm">{c.role}</div>
                    {c.credit && <div className="text-faint text-sm">{c.credit}</div>}
                    <div className="text-faint text-sm">ライセンス: {c.license}</div>
                    {src && (
                      <div className="text-sm">
                        {src.label}:{" "}
                        <button
                          onClick={() => void openExternalUrl(src.url).catch(() => {})}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            font: "inherit",
                            color: "var(--color-primary)",
                            textDecoration: "underline",
                            cursor: "pointer",
                          }}
                        >
                          {src.url}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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

import { useState } from "react";
import { PageHead } from "../components/ui";
import { PlayIcon } from "../components/icons";
import { SCREEN_TITLES } from "../screenTitles";
import { HELP_FLOW, HELP_PLACES, HELP_TIMELINE, HELP_TIPS, type HelpStep } from "../data/helpGuide";
import { TUTORIAL_VIDEOS, tutorialVideoSrc, type TutorialVideo } from "../data/tutorialVideos";

/** 案内1件（見出しは画面の名前をそのまま引く＝書き写さない・#1229）。 */
function GuideItem({ step, index }: { step: HelpStep; index?: number }) {
  return (
    <div className="list-item" style={{ cursor: "default", alignItems: "flex-start" }}>
      <div className="grow">
        <strong>
          {index !== undefined && <span className="text-muted">{index}. </span>}
          {SCREEN_TITLES[step.screen]}
        </strong>
        <div className="text-sm">{step.summary}</div>
        <ul style={{ margin: "6px 0 0", paddingLeft: "1.2em" }}>
          {step.detail.map((d) => (
            <li key={d} className="text-faint text-sm">{d}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * 使い方（#1229・ADR-0046 ①）。**操作案内**と**同梱したチュートリアル映像**を1か所に置く。
 *
 * ⚠️ **「準備中」をやめた**＝左の帯に押せない項目が3つ並んでいるだけで、
 * **使い方を伝える手段がどこにも無かった**（お問い合わせ・お知らせは入れる予定が無いので廃止）。
 * ⚠️ **映像は同梱**（`13`）＝社内・オフラインで使われうるので、再生に通信を要求しない。
 * ⚠️ **撮れていない映像は並べない**＝空のうちは一覧ごと出さず、操作案内だけを出す
 *（押しても何も起きない項目を作らない・§2-5）。
 */
export function HelpScreen() {
  const [playing, setPlaying] = useState<TutorialVideo | null>(null);

  return (
    <div className="main-scroll">
      <PageHead
        title={SCREEN_TITLES.help}
        desc="動画ができるまでの流れと、それぞれの画面ですることをまとめました。"
      />

      <div style={{ maxWidth: 820 }} className="col gap-lg">
        {TUTORIAL_VIDEOS.length > 0 && (
          <div className="card">
            <h2 className="section-title">見て覚える</h2>
            <p className="page-desc text-pretty">
              実際の操作を撮った映像です。このソフトの中で再生できます（インターネットにつながっていなくても見られます）。
            </p>
            {playing && (
              <video
                className="mt"
                style={{ width: "100%", borderRadius: 8, background: "#000" }}
                src={tutorialVideoSrc(playing)}
                controls
                autoPlay
                aria-label={`${playing.title}（映像）`}
              />
            )}
            <div className="col gap-sm mt">
              {TUTORIAL_VIDEOS.map((v) => (
                <button
                  key={v.id}
                  className={`list-item${playing?.id === v.id ? " active" : ""}`}
                  onClick={() => setPlaying(v)}
                  aria-current={playing?.id === v.id ? "true" : undefined}
                >
                  <PlayIcon size={18} className="nav-icon" />
                  <div className="grow" style={{ textAlign: "left" }}>
                    <strong>{v.title}</strong>
                    <div className="text-faint text-sm">{v.desc}</div>
                  </div>
                  <span className="text-faint text-sm">{v.durationLabel}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <h2 className="section-title">動画ができるまで</h2>
          <p className="page-desc text-pretty">
            上から順に進みます。途中で左のメニューからほかの場所へ行っても、「今の動画」から元の続きに戻れます。
          </p>
          <div className="col gap-sm mt">
            {HELP_FLOW.map((step, i) => (
              <GuideItem key={step.screen} step={step} index={i + 1} />
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="section-title">いつでも行ける場所</h2>
          <div className="col gap-sm mt">
            {HELP_PLACES.map((step) => (
              <GuideItem key={step.screen} step={step} />
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="section-title">時間を細かく作りたいとき</h2>
          <div className="col gap-sm mt">
            {HELP_TIMELINE.map((step) => (
              <GuideItem key={step.screen} step={step} />
            ))}
          </div>
        </div>

        <div className="card">
          <h2 className="section-title">覚えておくと楽なこと</h2>
          <div className="col gap-sm mt">
            {HELP_TIPS.map((t) => (
              <div className="list-item" key={t.title} style={{ cursor: "default", alignItems: "flex-start" }}>
                <div className="grow">
                  <strong>{t.title}</strong>
                  <div className="text-faint text-sm">{t.body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

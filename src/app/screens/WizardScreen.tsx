import { useState, type ChangeEvent } from "react";
import type { ScreenId } from "../data/mockData";
import { sampleCompany, purposeOptions } from "../data/mockData";
import { ASSET_TYPE, type Purpose } from "../../domain/enums";
import { useProjectStore } from "../store/projectStore";
import { YukoPanel } from "../components/YukoPanel";
import {
  ArrowLeftIcon,
  SaveIcon,
  ChevronRightIcon,
  PlusIcon,
  UploadIcon,
  PhotoIcon,
  VideoIcon,
  SparkleIcon,
  CheckIcon,
} from "../components/icons";
interface WizardProps {
  onNavigate: (screen: ScreenId) => void;
}

const steps = [
  "動画の目的を選ぶ",
  "会社情報を入力",
  "写真・動画を追加",
  "ゆうこの声を設定",
  "ゆうこに動画案を作ってもらう",
];

const yukoAdvice: Record<number, string[]> = {
  0: [
    "まずは、どんな目的の動画を作るか選びましょう。",
    "目的に合わせて、わたしが構成のたたき台を考えます。",
  ],
  1: [
    "会社情報は、あとからでも直せます。分かるところだけ入れてくださいね。",
    "「強み」は、求職者に伝えたい魅力を短く書くのがおすすめです。",
  ],
  2: [
    "写真や動画があると、動画がぐっと魅力的になります。",
    "なくても大丈夫。あとから追加もできますよ。",
  ],
  3: [
    "わたしの声の感じを選べます。落ち着いた声、明るい声などがあります。",
    "あとで仕上がりを聞きながら調整もできます。",
  ],
  4: [
    "準備ができたら、わたしが動画のたたき台を作ります。",
    "できあがった内容は、自由に確認・修正できますよ。",
  ],
};

export function WizardScreen({ onNavigate }: WizardProps) {
  // 最初のステップ「動画の目的を選ぶ」(index 0) を表示
  const [step, setStep] = useState(0);
  const [purpose, setPurpose] = useState("new_graduate");
  const [companyName, setCompanyName] = useState(sampleCompany.companyName);
  const [industry, setIndustry] = useState(sampleCompany.industry);
  const [jobType, setJobType] = useState(sampleCompany.jobType);
  const [strengths, setStrengths] = useState<string[]>(sampleCompany.strengths);
  const [newStrength, setNewStrength] = useState("");
  const [voiceType, setVoiceType] = useState("calm");

  const { assets, assetSrcById, addAsset, saveProject, saveStatus, applyProjectInfo } =
    useProjectStore();

  // ウィザードで入力した目的・会社情報を現在のプロジェクトへ反映する（保存・生成で使う）。
  function applyForm() {
    applyProjectInfo({
      purpose: purpose as Purpose, // purposeOptions の id は Purpose enum 値
      companyInfo: { companyName, industry, jobType, strengths },
    });
  }
  // 音声系（BGM/ナレーション）は素材一覧に出さない。
  const materials = assets.filter(
    (a) => a.assetType !== ASSET_TYPE.bgm && a.assetType !== ASSET_TYPE.voice,
  );

  function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    void addAsset(file);
    e.target.value = "";
  }

  function addStrength() {
    const v = newStrength.trim();
    if (!v) return;
    setStrengths([...strengths, v]);
    setNewStrength("");
  }

  function next() {
    if (step < steps.length - 1) setStep(step + 1);
    else {
      applyForm(); // ウィザードを抜ける＝入力を確定
      onNavigate("confirm");
    }
  }
  function back() {
    if (step > 0) setStep(step - 1);
    else onNavigate("home");
  }

  return (
    <div className="main-scroll">
      <div className="content-with-yuko">
        <div>
          {/* ステッパー */}
          <div className="stepper">
            {steps.map((label, i) => (
              <div
                key={label}
                className={`step${i === step ? " active" : ""}${i < step ? " done" : ""}`}
                style={{ flex: i === steps.length - 1 ? "0 0 auto" : 1 }}
              >
                <div className="step-circle">
                  {i < step ? <CheckIcon size={16} /> : i + 1}
                </div>
                <span className="step-label">{label}</span>
                {i < steps.length - 1 && (
                  <span className={`step-line${i < step ? " done" : ""}`} />
                )}
              </div>
            ))}
          </div>

          <div className="card">
            {/* ステップ1: 目的 */}
            {step === 0 && (
              <>
                <h2 className="section-title">どんな動画を作りますか？</h2>
                <div className="card-grid cols-2">
                  {purposeOptions.map((opt) => (
                    <button
                      key={opt.id}
                      className="action-card"
                      style={{
                        borderColor:
                          purpose === opt.id ? "var(--color-primary)" : undefined,
                        background:
                          purpose === opt.id ? "var(--color-primary-soft)" : undefined,
                      }}
                      onClick={() => setPurpose(opt.id)}
                    >
                      <span className="action-card-title">{opt.label}</span>
                      <span className="action-card-desc">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* ステップ2: 会社情報 */}
            {step === 1 && (
              <>
                <h2 className="section-title">会社情報を入力</h2>
                <div className="field">
                  <label className="field-label" htmlFor="companyName">
                    会社名
                  </label>
                  <input
                    id="companyName"
                    className="input"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="例：株式会社サンプル"
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="industry">
                    業種
                  </label>
                  <input
                    id="industry"
                    className="input"
                    value={industry}
                    onChange={(e) => setIndustry(e.target.value)}
                    placeholder="例：IT・業務システム開発"
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="jobType">
                    募集職種
                  </label>
                  <input
                    id="jobType"
                    className="input"
                    value={jobType}
                    onChange={(e) => setJobType(e.target.value)}
                    placeholder="例：エンジニア（新卒）"
                  />
                </div>
                <div className="field">
                  <label className="field-label">強み</label>
                  <div className="chip-input-row">
                    {strengths.map((s, i) => (
                      <span className="chip" key={i}>
                        {s}
                        <button
                          aria-label={`${s}を削除`}
                          onClick={() =>
                            setStrengths(strengths.filter((_, idx) => idx !== i))
                          }
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="row gap-sm">
                    <input
                      className="input"
                      value={newStrength}
                      onChange={(e) => setNewStrength(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addStrength()}
                      placeholder="例：相談しやすい環境"
                    />
                    <button className="btn btn-secondary" onClick={addStrength}>
                      <PlusIcon size={16} />
                      強みを追加
                    </button>
                  </div>
                  <p className="field-hint">
                    求職者に伝えたい魅力を、短い言葉で入れてください。
                  </p>
                </div>
              </>
            )}

            {/* ステップ3: 写真・動画 */}
            {step === 2 && (
              <>
                <h2 className="section-title">写真・動画を追加</h2>
                <p className="page-desc mb">
                  会社の写真や動画を追加すると、動画がより魅力的になります。
                </p>
                <label
                  className="card-tight text-center"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.currentTarget.querySelector("input")?.click();
                    }
                  }}
                  style={{
                    border: "2px dashed var(--color-border-strong)",
                    background: "var(--color-surface-alt)",
                    padding: "var(--gap-xl)",
                    display: "block",
                    cursor: "pointer",
                  }}
                >
                  <UploadIcon size={32} className="text-faint" />
                  <p className="mt text-muted">ここから写真や動画を選んでください</p>
                  <span className="btn btn-primary mt">
                    <UploadIcon size={18} />
                    写真・動画を選ぶ
                  </span>
                  <input type="file" accept="image/*,video/*" onChange={onUpload} style={{ display: "none" }} />
                </label>
                {materials.length > 0 ? (
                  <div className="card-grid cols-4 mt">
                    {materials.map((a) => (
                      <div
                        key={a.assetId}
                        className={`thumb ${a.assetType === ASSET_TYPE.video ? "thumb-video" : "thumb-photo"}`}
                        style={{ overflow: "hidden" }}
                        title={a.displayName}
                      >
                        {assetSrcById[a.assetId] ? (
                          <img
                            src={assetSrcById[a.assetId]}
                            alt={a.displayName}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ) : a.assetType === ASSET_TYPE.video ? (
                          <VideoIcon size={22} />
                        ) : (
                          <PhotoIcon size={22} />
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="field-hint mt">
                    まだ素材はありません。なくても動画は作れます（あとから追加もできます）。
                  </p>
                )}
              </>
            )}

            {/* ステップ4: ゆうこの声 */}
            {step === 3 && (
              <>
                <h2 className="section-title">ゆうこの声を設定</h2>
                <p className="page-desc mb">
                  動画で話す「ゆうこの声」の感じを選べます。
                </p>
                <div className="card-grid cols-3">
                  {[
                    { id: "calm", label: "落ち着いた声", desc: "丁寧で安心感のある話し方" },
                    { id: "bright", label: "明るい声", desc: "元気で親しみやすい話し方" },
                    { id: "soft", label: "やわらかい声", desc: "やさしくゆったりした話し方" },
                  ].map((v) => (
                    <button
                      key={v.id}
                      className="action-card"
                      style={{
                        borderColor:
                          voiceType === v.id ? "var(--color-primary)" : undefined,
                        background:
                          voiceType === v.id ? "var(--color-primary-soft)" : undefined,
                      }}
                      onClick={() => setVoiceType(v.id)}
                    >
                      <span className="action-card-title">{v.label}</span>
                      <span className="action-card-desc">{v.desc}</span>
                    </button>
                  ))}
                </div>
                <p className="field-hint mt">
                  話す速さや声の高さは、あとから設定画面でも調整できます。
                </p>
              </>
            )}

            {/* ステップ5: 動画案を作る */}
            {step === 4 && (
              <div className="text-center" style={{ padding: "var(--gap-lg) 0" }}>
                <div
                  className="action-card-icon"
                  style={{
                    background: "var(--color-yellow)",
                    color: "#8a6d1a",
                    margin: "0 auto var(--gap)",
                    width: 64,
                    height: 64,
                  }}
                >
                  <SparkleIcon size={32} />
                </div>
                <h2 className="section-title">準備ができました</h2>
                <p className="page-desc" style={{ maxWidth: 460, margin: "0 auto" }}>
                  入力いただいた内容をもとに、ゆうこが動画のたたき台を作ります。
                  作ったあとは、自由に確認・修正できます。
                </p>
                <button
                  className="btn btn-primary btn-lg mt-lg"
                  onClick={() => {
                    applyForm();
                    onNavigate("confirm");
                  }}
                >
                  <SparkleIcon size={20} />
                  ゆうこに動画案を作ってもらう
                </button>
              </div>
            )}
          </div>

          {/* 操作ボタン */}
          <div className="row-between mt-lg">
            <button className="btn btn-ghost" onClick={back}>
              <ArrowLeftIcon size={18} />
              戻る
            </button>
            <div className="row gap-sm">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  applyForm(); // 入力中の目的・会社情報も保存に反映
                  void saveProject();
                }}
                disabled={saveStatus === "saving"}
              >
                <SaveIcon size={18} />
                {saveStatus === "saving"
                  ? "保存中…"
                  : saveStatus === "saved"
                    ? "保存しました"
                    : saveStatus === "error"
                      ? "保存に失敗（もう一度押す）"
                      : "ここまで保存"}
              </button>
              {step < steps.length - 1 && (
                <button className="btn btn-primary" onClick={next}>
                  次へ
                  <ChevronRightIcon size={18} />
                </button>
              )}
            </div>
          </div>
        </div>

        <YukoPanel title="ゆうこからのアドバイス" messages={yukoAdvice[step]} />
      </div>
    </div>
  );
}

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { ScreenId } from "../data/mockData";
import { generalPurposeOptions, purposeOptions } from "../data/mockData";
import { ASSET_TYPE, ORIENTATION, VIDEO_KIND, type Orientation, type Purpose, type VideoKind } from "../../domain/enums";
import {
  ADDITIONAL_NOTES_MAX_LEN, DEFAULT_TONE, GENERAL_LIST_ITEM_MAX_LEN, GENERAL_LIST_MAX_ITEMS,
  GENERAL_TARGET_AUDIENCE_MAX_LEN, GENERAL_TITLE_MAX_LEN, TONE_PRESETS,
} from "../../domain/constants";
import { VOICE_STYLE_PRESETS, matchVoiceStyleId, voiceStyleParams } from "../../domain/voice/voiceStylePresets";
import { useProjectStore } from "../store/projectStore";
import { isTauri } from "../../infrastructure/assetFs";
import { showOpenAssetDialog } from "../../infrastructure/dialog";
import { YukoPanel } from "../components/YukoPanel";
import { ExportLockBanner } from "../components/ExportLockBanner";
import { saveButtonLabel } from "../components/saveButtonLabel";
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

// 動画の種類（ADR-0011）。表示名は正典 06§3。目的の選択肢はこの種類で切り替わる。
const videoKindOptions: { id: VideoKind; label: string; desc: string }[] = [
  { id: VIDEO_KIND.recruit, label: "採用動画", desc: "会社・仕事の魅力を求職者に伝える" },
  { id: VIDEO_KIND.general, label: "一般動画・社内発表", desc: "社内発表・報告・製品紹介など" },
];

// 画面の向き（ADR-0012）。横型＝従来、縦型＝スマホ向け。寸法は videoSettings.aspectRatio から導出（§2-7）。
const orientationOptions: { id: Orientation; label: string; desc: string }[] = [
  { id: ORIENTATION.landscape, label: "横型（16:9）", desc: "パソコン・テレビ・YouTube向け" },
  { id: ORIENTATION.portrait, label: "縦型（9:16）", desc: "スマホ・ショート動画向け" },
];

// ステップ見出しは videoKind で2番目だけ変える（採用＝会社情報 / 一般＝発表の内容）。
function stepsFor(videoKind: VideoKind): string[] {
  const second = videoKind === VIDEO_KIND.general ? "発表の内容を入力" : "会社情報を入力";
  return ["動画の種類と目的", second, "写真・動画を追加", "読み上げの声を設定", "ゆうこに動画案を作ってもらう"];
}

const yukoAdvice: Record<number, string[]> = {
  0: [
    "まずは、動画の種類と目的を選びましょう。",
    "種類や目的に合わせて、わたしが構成のたたき台を考えます。",
  ],
  1: [
    "会社情報は、あとからでも直せます。分かるところだけ入れてくださいね。",
    "「アピールしたいこと」は、求職者に伝えたい魅力を短く書くのがおすすめです。",
  ],
  2: [
    "写真や動画があると、動画がぐっと魅力的になります。",
    "なくても大丈夫。あとから追加もできますよ。",
  ],
  3: [
    "読み上げの声の感じを選べます。落ち着いた声、明るい声などがあります。",
    "あとで仕上がりを聞きながら調整もできます。",
  ],
  4: [
    "準備ができたら、わたしが動画のたたき台を作ります。",
    "できあがった内容は、自由に確認・修正できますよ。",
  ],
};

// 一般・社内発表のときの step1 アドバイス（会社情報ではなく発表内容）。
const generalStep1Advice = [
  "動画のテーマと、話す順番（構成）を決めましょう。",
  "伝えたい要点を箇条書きにすると、ゆうこが分かりやすくまとめます。",
];

function adviceFor(step: number, videoKind: VideoKind): string[] {
  if (step === 1 && videoKind === VIDEO_KIND.general) return generalStep1Advice;
  return yukoAdvice[step] ?? [];
}

export function WizardScreen({ onNavigate }: WizardProps) {
  // ステップは store に保持した値から開く（#401）：サイドバー離脱→復帰や confirm「キャンセル」で
  // step0 に戻らず直前のステップを再開する（新規/読込では 0）。
  const [step, setStep] = useState(() => useProjectStore.getState().wizardStep);
  // ウィザードは現在のプロジェクト(meta)を初期値にする＝「ここまで保存」後に開き直しても消えない
  // （未入力でも空文字で上書きしてしまう問題を避ける。applyProjectInfo は companyInfo を全置換するため）。
  const initialMeta = useProjectStore.getState().meta;
  const c0 = initialMeta.companyInfo;
  const g0 = initialMeta.generalBrief;
  const [videoKind, setVideoKind] = useState<VideoKind>(initialMeta.videoKind ?? VIDEO_KIND.recruit);
  const [purpose, setPurpose] = useState<Purpose>(initialMeta.purpose);
  const [aspectRatio, setAspectRatio] = useState<Orientation>(initialMeta.videoSettings.aspectRatio);
  const [companyName, setCompanyName] = useState(c0?.companyName ?? "");
  const [industry, setIndustry] = useState(c0?.industry ?? "");
  const [jobType, setJobType] = useState(c0?.jobType ?? "");
  const [strengths, setStrengths] = useState<string[]>(c0?.strengths ?? []);
  const [newStrength, setNewStrength] = useState("");
  const [businessDescription, setBusinessDescription] = useState(c0?.businessDescription ?? "");
  const [recruitTarget, setRecruitTarget] = useState(c0?.recruitTarget ?? "");
  const [desiredPerson, setDesiredPerson] = useState(c0?.desiredPerson ?? "");
  // 自由記述はトップレベル additionalNotes（両用途共通・ADR-0011。companyInfo からは外す）。
  const [additionalNotes, setAdditionalNotes] = useState(initialMeta.additionalNotes ?? "");
  // 一般・社内発表（videoKind=general）の入力＝generalBrief（テーマ／章立て／要点）。
  const [title, setTitle] = useState(g0?.title ?? "");
  const [agenda, setAgenda] = useState<string[]>(g0?.agenda ?? []);
  const [newAgenda, setNewAgenda] = useState("");
  const [keyPoints, setKeyPoints] = useState<string[]>(g0?.keyPoints ?? []);
  const [newKeyPoint, setNewKeyPoint] = useState("");
  // 対象視聴者（general の generalBrief.targetAudience）・トーン（toneSettings.tone）＝ADR-0011 #12。
  const [targetAudience, setTargetAudience] = useState(g0?.targetAudience ?? "");
  const [tone, setTone] = useState(initialMeta.toneSettings?.tone ?? DEFAULT_TONE);
  // 読み上げの声の感じ。現在の voiceSettings から一致プリセットを初期選択（無ければ既定）。
  const [voiceType, setVoiceType] = useState(() => matchVoiceStyleId(initialMeta.voiceSettings));
  // フォーム入力の不足を伝えるユーザー向け文言（§2-5・次の行動を示す）。
  const [formError, setFormError] = useState<string | null>(null);

  const { assets, assetSrcById, addAsset, addAssetByPath, updateAsset, saveProject, saveStatus, applyProjectInfo, setWizardStep, importError, clearImportError } =
    useProjectStore();

  const steps = stepsFor(videoKind);

  // 現在ステップを store に同期（離脱で消えないように・#401）。初回は store と同値ゆえ no-op。
  useEffect(() => {
    setWizardStep(step);
  }, [step, setWizardStep]);
  // 目的の選択肢は種類で切り替える（採用7／一般4・混在不可）。
  const currentPurposeOptions = videoKind === VIDEO_KIND.general ? generalPurposeOptions : purposeOptions;

  // ウィザードの入力を現在のプロジェクトへ反映する（保存・生成で使う）。
  // videoKind で会社情報/発表内容を排他に渡す（applyProjectInfo が渡さない側を消す＝schema 排他を満たす）。
  function applyForm() {
    // voice（声の感じ→speed/pitch/intonation）は両用途共通（声ステップは recruit/general 共通）。
    const common = { videoKind, purpose, aspectRatio, additionalNotes, voice: voiceStyleParams(voiceType) };
    if (videoKind === VIDEO_KIND.general) {
      applyProjectInfo({
        ...common,
        generalBrief: { title, agenda, keyPoints, ...(targetAudience.trim() ? { targetAudience } : {}) },
        tone,
      });
    } else {
      // recruit では tone を渡さない（将来の明示入力まで既存 toneSettings を維持）。対象視聴者は recruitTarget を使う。
      applyProjectInfo({
        ...common,
        companyInfo: { companyName, industry, businessDescription, recruitTarget, jobType, strengths, desiredPerson },
      });
    }
  }

  // 「最後に確定(commit)したフォーム内容」のスナップショット（#401 レビュー：完了時の二重 applyForm を防ぐ）。
  // 初期値＝マウント時のフォーム（=store 由来）。編集が無ければアンマウント確定を skip し、pushHistory の二重積みを防ぐ。
  const formSnapshot = (): string =>
    JSON.stringify([videoKind, purpose, aspectRatio, companyName, industry, jobType, strengths,
      businessDescription, recruitTarget, desiredPerson, additionalNotes, title, agenda, keyPoints, targetAudience, tone, voiceType]);
  const committedRef = useRef(formSnapshot());
  // 明示の確定ポイント（次へ／ここまで保存／完了）はこれを使う＝確定後スナップショットを更新して再確定を防ぐ。
  function commitForm() {
    applyForm();
    committedRef.current = formSnapshot();
  }
  // 離脱（サイドバー移動・戻る等でアンマウント）時、入力があり かつ 最後の確定以降に編集があるときだけ store へ確定（#401）。
  // render 中の ref 代入は不可なので effect で最新の確定処理を ref に同期し、アンマウント cleanup で1回呼ぶ。
  const persistRef = useRef<() => void>(() => {});
  useEffect(() => {
    persistRef.current = () => {
      if ((companyName.trim() || title.trim()) && formSnapshot() !== committedRef.current) applyForm();
    };
  });
  useEffect(() => () => persistRef.current(), []);
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

  // Tauri ではネイティブの「開く」ダイアログでパスを取り込む（JSが素材バイトを読まない）。ブラウザは下の input にフォールバック。
  async function onPickAsset() {
    const path = await showOpenAssetDialog();
    if (path) await addAssetByPath(path);
  }

  // 箇条書き（強み・章立て・要点）共通の追加ロジック。
  function addItem(raw: string, list: string[], setList: (v: string[]) => void, clear: () => void) {
    const v = raw.trim();
    if (!v) return;
    setList([...list, v]);
    clear();
  }
  function addStrength() { addItem(newStrength, strengths, setStrengths, () => setNewStrength("")); }
  function addAgenda() { if (agenda.length >= GENERAL_LIST_MAX_ITEMS) return; addItem(newAgenda, agenda, setAgenda, () => setNewAgenda("")); }
  function addKeyPoint() { if (keyPoints.length >= GENERAL_LIST_MAX_ITEMS) return; addItem(newKeyPoint, keyPoints, setKeyPoints, () => setNewKeyPoint("")); }
  // 動画の種類を切り替える。目的の許可enumが変わるので、別種別の目的が残らないよう既定へ寄せる。
  function changeVideoKind(kind: VideoKind) {
    setVideoKind(kind);
    const opts = kind === VIDEO_KIND.general ? generalPurposeOptions : purposeOptions;
    if (!opts.some((o) => o.id === purpose)) setPurpose(opts[0].id);
  }

  function next() {
    // 一般は発表内容ステップでテーマ未入力のまま進めない（schema は title 必須・§2-5 の「次の行動」を示す）。
    if (step === 1 && videoKind === VIDEO_KIND.general && !title.trim()) {
      setFormError("動画のテーマ・タイトルを入力してください。");
      return;
    }
    // 採用は会社情報ステップで会社名未入力のまま進めない（schema は companyName 必須・minLength 1・#414・§2-5）。
    if (step === 1 && videoKind === VIDEO_KIND.recruit && !companyName.trim()) {
      setFormError("会社名を入力してください。");
      return;
    }
    setFormError(null);
    if (step < steps.length - 1) {
      commitForm(); // 前進のたびに入力を store へ確定（離脱でロストしない・未保存表示/自動保存/破棄ガードの射程に入る・#401）
      setStep(step + 1);
    } else {
      commitForm(); // ウィザードを抜ける＝入力を確定（確定済みマークでアンマウント二重確定を防ぐ）
      onNavigate("confirm");
    }
  }
  function back() {
    setFormError(null);
    if (step > 0) setStep(step - 1);
    else onNavigate("home");
  }

  return (
    <div className="main-scroll">
      <div className="content-with-yuko">
        <div>
          {/* 書き出し中の案内（#570 P3 レビュー）。ウィザードの入力保存（applyProjectInfo）は書き出し中 no-op のため、
              他画面と同じくバナーで「効かない」を明示する（silent no-op を避ける・ADR-0026④）。 */}
          <ExportLockBanner onNavigate={onNavigate} />
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
                {/* 動画の種類（採用/一般）。選ぶと下の「目的」の選択肢が切り替わる（ADR-0011）。 */}
                <div className="card-grid cols-2">
                  {videoKindOptions.map((opt) => (
                    <button
                      key={opt.id}
                      className="action-card"
                      // 選択中は色だけでなく aria-pressed でも伝える（キーボード/読み上げ・#412）
                      aria-pressed={videoKind === opt.id}
                      style={{
                        borderColor: videoKind === opt.id ? "var(--color-primary)" : undefined,
                        background: videoKind === opt.id ? "var(--color-primary-soft)" : undefined,
                      }}
                      onClick={() => changeVideoKind(opt.id)}
                    >
                      <span className="action-card-title">{opt.label}</span>
                      <span className="action-card-desc">{opt.desc}</span>
                    </button>
                  ))}
                </div>
                <h3 className="field-label mt-lg">目的</h3>
                <div className="card-grid cols-2">
                  {currentPurposeOptions.map((opt) => (
                    <button
                      key={opt.id}
                      className="action-card"
                      aria-pressed={purpose === opt.id}
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
                <h3 className="field-label mt-lg">画面の向き</h3>
                <div className="card-grid cols-2">
                  {orientationOptions.map((opt) => (
                    <button
                      key={opt.id}
                      className="action-card"
                      aria-pressed={aspectRatio === opt.id}
                      style={{
                        borderColor: aspectRatio === opt.id ? "var(--color-primary)" : undefined,
                        background: aspectRatio === opt.id ? "var(--color-primary-soft)" : undefined,
                      }}
                      onClick={() => setAspectRatio(opt.id)}
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
                <h2 className="section-title">
                  {videoKind === VIDEO_KIND.general ? "発表の内容を入力" : "会社情報を入力"}
                </h2>
                {formError && (
                  <div className="notice notice-warn mb" role="alert">{formError}</div>
                )}
                {videoKind === VIDEO_KIND.recruit && (
                  <>
                <div className="field">
                  <label className="field-label" htmlFor="companyName">
                    会社名
                  </label>
                  <input
                    id="companyName"
                    className="input"
                    value={companyName}
                    onChange={(e) => {
                      setCompanyName(e.target.value);
                      if (formError) setFormError(null); // 入力し始めたら必須エラーを消す（title 欄と同じ挙動・#414 レビュー）
                    }}
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
                  <label className="field-label" htmlFor="businessDescription">
                    事業内容
                  </label>
                  <textarea
                    id="businessDescription"
                    className="textarea"
                    value={businessDescription}
                    onChange={(e) => setBusinessDescription(e.target.value)}
                    placeholder="例：中小企業向けの業務システムを開発・運用しています"
                    rows={2}
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
                  <label className="field-label" htmlFor="recruitTarget">
                    採用対象
                  </label>
                  <input
                    id="recruitTarget"
                    className="input"
                    value={recruitTarget}
                    onChange={(e) => setRecruitTarget(e.target.value)}
                    placeholder="例：新卒・第二新卒"
                  />
                </div>
                <div className="field">
                  <label className="field-label">アピールしたいこと（強み・伝えたい点）</label>
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
                      onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === "Enter") addStrength(); }}
                      placeholder="例：相談しやすい環境"
                    />
                    <button className="btn btn-secondary" onClick={addStrength}>
                      <PlusIcon size={16} />
                      強みを追加
                    </button>
                  </div>
                  <p className="field-hint">
                    求職者に伝えたい魅力・強みを、短い言葉で複数入れてください。
                  </p>
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="desiredPerson">
                    求める人物像
                  </label>
                  <input
                    id="desiredPerson"
                    className="input"
                    value={desiredPerson}
                    onChange={(e) => setDesiredPerson(e.target.value)}
                    placeholder="例：主体的に学べる人"
                  />
                </div>
                  </>
                )}

                {videoKind === VIDEO_KIND.general && (
                  <>
                    <div className="field">
                      <label className="field-label" htmlFor="title">テーマ・タイトル</label>
                      <input
                        id="title"
                        className="input"
                        value={title}
                        onChange={(e) => {
                          setTitle(e.target.value);
                          if (formError) setFormError(null);
                        }}
                        placeholder="例：全社キックオフ2026 / 新製品○○のご紹介"
                        maxLength={GENERAL_TITLE_MAX_LEN}
                      />
                      <div className="row-between field-hint">
                        <span />
                        <span>{title.length}/{GENERAL_TITLE_MAX_LEN}</span>
                      </div>
                    </div>
                    <div className="field">
                      <label className="field-label">構成（章立て・話す順番）</label>
                      <div className="chip-input-row">
                        {agenda.map((s, i) => (
                          <span className="chip" key={i}>
                            {s}
                            <button
                              aria-label={`${s}を削除`}
                              onClick={() => setAgenda(agenda.filter((_, idx) => idx !== i))}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="row gap-sm">
                        <input
                          className="input"
                          value={newAgenda}
                          onChange={(e) => setNewAgenda(e.target.value)}
                          onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === "Enter") addAgenda(); }}
                          placeholder="例：今期の方針"
                          maxLength={GENERAL_LIST_ITEM_MAX_LEN}
                        />
                        <button
                          className="btn btn-secondary"
                          onClick={addAgenda}
                          disabled={agenda.length >= GENERAL_LIST_MAX_ITEMS}
                        >
                          <PlusIcon size={16} />
                          構成を追加
                        </button>
                      </div>
                      <p className="field-hint">
                        話す順番（章立て）を、上から順に追加してください（最大{GENERAL_LIST_MAX_ITEMS}件）。
                      </p>
                    </div>
                    <div className="field">
                      <label className="field-label">伝えたい要点</label>
                      <div className="chip-input-row">
                        {keyPoints.map((s, i) => (
                          <span className="chip" key={i}>
                            {s}
                            <button
                              aria-label={`${s}を削除`}
                              onClick={() => setKeyPoints(keyPoints.filter((_, idx) => idx !== i))}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="row gap-sm">
                        <input
                          className="input"
                          value={newKeyPoint}
                          onChange={(e) => setNewKeyPoint(e.target.value)}
                          onKeyDown={(e) => { if (!e.nativeEvent.isComposing && e.key === "Enter") addKeyPoint(); }}
                          placeholder="例：売上は前年比120%"
                          maxLength={GENERAL_LIST_ITEM_MAX_LEN}
                        />
                        <button
                          className="btn btn-secondary"
                          onClick={addKeyPoint}
                          disabled={keyPoints.length >= GENERAL_LIST_MAX_ITEMS}
                        >
                          <PlusIcon size={16} />
                          要点を追加
                        </button>
                      </div>
                      <p className="field-hint">
                        動画で必ず伝えたいポイントを、短い言葉で複数入れてください（最大{GENERAL_LIST_MAX_ITEMS}件）。
                      </p>
                    </div>
                    <div className="field">
                      <label className="field-label" htmlFor="targetAudience">対象視聴者</label>
                      <input
                        id="targetAudience"
                        className="input"
                        value={targetAudience}
                        onChange={(e) => setTargetAudience(e.target.value)}
                        placeholder="例：全社員 / 新入社員 / 取引先"
                        maxLength={GENERAL_TARGET_AUDIENCE_MAX_LEN}
                      />
                      <div className="row-between field-hint">
                        <span>誰に向けた動画かを書くと、ゆうこが言葉づかいを合わせます（任意）。</span>
                        <span>{targetAudience.length}/{GENERAL_TARGET_AUDIENCE_MAX_LEN}</span>
                      </div>
                    </div>
                    <div className="field">
                      <label className="field-label">トーン（話し方の雰囲気）</label>
                      <div className="card-grid cols-2">
                        {TONE_PRESETS.map((t) => (
                          <button
                            key={t}
                            className="action-card"
                            aria-pressed={tone === t}
                            style={{
                              borderColor: tone === t ? "var(--color-primary)" : undefined,
                              background: tone === t ? "var(--color-primary-soft)" : undefined,
                            }}
                            onClick={() => setTone(t)}
                          >
                            <span className="action-card-title">{t}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                <div className="field">
                  <label className="field-label" htmlFor="additionalNotes">
                    その他・伝えたいこと（自由記述）
                  </label>
                  <textarea
                    id="additionalNotes"
                    className="textarea"
                    value={additionalNotes}
                    maxLength={ADDITIONAL_NOTES_MAX_LEN}
                    onChange={(e) => setAdditionalNotes(e.target.value)}
                    placeholder="動画で特に伝えたいこと・雰囲気・避けたい表現などを自由に書けます。ここに書いた内容はそのまま動画案づくりに渡ります。"
                    rows={4}
                  />
                  <div className="row-between field-hint">
                    <span>自由に書いた内容を、そのまま動画案づくりに反映します。</span>
                    <span>
                      {additionalNotes.length}/{ADDITIONAL_NOTES_MAX_LEN}
                    </span>
                  </div>
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
                  onClick={(e) => {
                    if (isTauri()) {
                      e.preventDefault();
                      void onPickAsset();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (isTauri()) {
                        void onPickAsset();
                      } else {
                        e.currentTarget.querySelector("input")?.click();
                      }
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

                {importError && (
                  <div className="notice notice-warn row-between mt" role="alert">
                    <span>{importError}</span>
                    <button className="btn btn-ghost text-sm" onClick={clearImportError}>閉じる</button>
                  </div>
                )}
                {materials.length > 0 ? (
                  <div className="col gap-sm mt">
                    <p className="field-hint">
                      各素材に説明を付けると、ゆうこが使いどころを判断しやすくなります（任意）。
                    </p>
                    {materials.map((a) => (
                      <div key={a.assetId} className="row gap-sm" style={{ alignItems: "flex-start" }}>
                        <div
                          className={`thumb ${a.assetType === ASSET_TYPE.video ? "thumb-video" : "thumb-photo"}`}
                          style={{ width: 56, height: 56, flex: "0 0 auto", overflow: "hidden" }}
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
                        <div className="grow">
                          <div className="text-sm" style={{ fontWeight: 600, marginBottom: 4 }}>
                            {a.displayName}
                          </div>
                          <input
                            className="input"
                            value={a.description ?? ""}
                            onChange={(e) =>
                              updateAsset(a.assetId, (x) => ({ ...x, description: e.target.value }))
                            }
                            placeholder="この素材の説明（例：オフィスの様子）"
                          />
                        </div>
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

            {/* ステップ4: 読み上げの声 */}
            {step === 3 && (
              <>
                <h2 className="section-title">読み上げの声を設定</h2>
                <p className="page-desc mb">
                  動画で話す「読み上げの声」の感じを選べます。
                </p>
                <div className="card-grid cols-3">
                  {VOICE_STYLE_PRESETS.map((v) => (
                    <button
                      key={v.id}
                      className="action-card"
                      aria-pressed={voiceType === v.id}
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
                    color: "var(--color-warn)",
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
                    commitForm(); // 確定してから確認画面へ（アンマウント二重確定を防ぐ・#401 レビュー）
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
                  commitForm(); // 入力中の目的・会社情報も保存に反映（確定済みマークでアンマウント二重確定を防ぐ）
                  void saveProject();
                }}
                disabled={saveStatus === "saving"}
              >
                <SaveIcon size={18} />
                {saveButtonLabel(saveStatus)}
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

        <YukoPanel title="ゆうこからのアドバイス" messages={adviceFor(step, videoKind)} />
      </div>
    </div>
  );
}

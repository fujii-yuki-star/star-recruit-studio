import { useEffect, useRef, useState } from "react";
import { userFacingMessage } from "../userFacingError";
import { apiKeyMessage } from "../uiLabels";
import type { ScreenId } from "../data/mockData";
import { PageHead } from "../components/ui";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { useAppearance } from "../hooks/useAppearance";
import type { Appearance } from "../../infrastructure/appSettings";
import { SECTION_SCOPE } from "../components/sectionOpen";
import { PlayIcon, StopIcon } from "../components/icons";
import { BrandKitSection } from "../components/BrandKitSection";
import { TroubleLogSection } from "../components/TroubleLogSection";
import { ReadingDictSection } from "../components/ReadingDictSection";
import { UserFontSection } from "../components/UserFontSection";
import { ExportLockBanner } from "../components/ExportLockBanner";
import { DeleteConfirm } from "../components/DeleteConfirm";
import { isExportBusy, useProjectStore } from "../store/projectStore";
import { useAudioPreview } from "../hooks/useAudioPreview";
import { useHistoryGroup } from "../hooks/useHistoryGroup";
import { GEMINI_PROVIDER, deleteApiKey, hasApiKey, saveApiKey } from "../../infrastructure/aiClient";
import {
  DEFAULT_AI_MODEL, getAiModel, getVoicevoxSpeaker, getVoicevoxUrl,
  setAiModel, setVoicevoxSpeaker, setVoicevoxUrl,
} from "../../infrastructure/appSettings";
import { VOICE_CATALOG, DEFAULT_SPEAKER, characterForSpeaker } from "../../domain/voice/voiceCatalog";
import { creditForSpeaker } from "../../domain/voice/narratorCredit";
import {
  INTONATION_RANGE, PITCH_RANGE, SPEED_RANGE, sliderToValue, valueToSlider,
} from "../../domain/voice/voiceParams";
import {
  H264_INITIAL_STATUS, H264_STATUS_LABEL, OPENH264_CREDIT_TEXT, OPENH264_FEATURE_ENABLED,
  type H264FeatureStatus,
} from "../../domain/export/h264Feature";

/**
 * 見た目の3択（ADR-0039）。
 *
 * ⚠️ **画面に出す語は「見た目・明るい・暗い」**（§2-3＝`テーマ` `ダークモード` `ライト/ダーク` は出さない）。
 * ⚠️ **「パソコンの設定に合わせる」を先頭に置く**＝これが既定（`APPEARANCE_DEFAULT`）なので、
 * いま何が効いているのかが並びの先頭で分かる。
 */
// ⚠️ **「OS」と書かない**（レビュー 🟡・§2-3）＝利用者は人事・非エンジニア。技術寄りの略語を画面に出さない。
export const APPEARANCE_CHOICES: [Appearance, string][] = [
  ["system", "パソコンの設定に合わせる"],
  ["light", "明るい"],
  ["dark", "暗い"],
];

export function SettingsScreen({ onNavigate }: { onNavigate: (screen: ScreenId) => void }) {
  // 見た目（ADR-0039・#1108）。⚠️ **動画の絵は変わらない**＝暗くなるのはアプリの枠だけ。
  const [appearance, setAppearance] = useAppearance();
  const synthesizePreview = useProjectStore((s) => s.synthesizePreview);
  const voiceSettings = useProjectStore((s) => s.meta.voiceSettings);
  const updateVoiceSettings = useProjectStore((s) => s.updateVoiceSettings);
  const isExporting = useProjectStore((s) => isExportBusy(s.exportRun.phase)); // 書き出し中は声パラメタを止める（#570 P2）
  // 声パラメータ（速さ/高さ/抑揚）スライダーのドラッグを1履歴に（#389・場面編集側と同じ挙動に揃える）。
  const { dragGroup } = useHistoryGroup();

  const [keyInput, setKeyInput] = useState("");
  const [aiConnected, setAiConnected] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyError, setKeyError] = useState("");
  // 接続キーの削除も共通の確認へ（#410）。キーは復元できないため確認必須（即時削除だった）。
  const [confirmClearKey, setConfirmClearKey] = useState(false);
  const [aiModel, setAiModelState] = useState(() => getAiModel());

  function onChangeModel(value: string) {
    setAiModelState(value);
    setAiModel(value);
  }
  const [voicevoxUrl, setUrl] = useState(() => getVoicevoxUrl());
  const [speaker, setSpeaker] = useState(() => {
    // 保存済み speaker がカタログに無い（旧値・破損）なら既定へ（select の選択肢と state の乖離を防ぐ）。
    const saved = getVoicevoxSpeaker();
    return saved != null && characterForSpeaker(saved) != null ? saved : DEFAULT_SPEAKER;
  });
  const [testState, setTestState] = useState<"idle" | "loading" | "error">("idle");
  const [testError, setTestError] = useState("");
  // 試し聞きの再生制御（#388）：画面遷移で停止・連打で重ならない・再生中は「停止」表示。
  const audioPreview = useAudioPreview();
  // 動画保存の予備機能の状態（実検出は取得・検証実装後＝pin 後。今は表示枠用のプレースホルダ）。
  const h264Status: H264FeatureStatus = H264_INITIAL_STATUS;

  function onChangeUrl(value: string) {
    setUrl(value);
    setVoicevoxUrl(value);
  }
  function onChangeSpeaker(value: number) {
    setSpeaker(value);
    setVoicevoxSpeaker(value);
  }
  async function onTestVoice() {
    // 再生中にもう一度押したら停止（投げっぱなしにしない・#388）。
    if (audioPreview.playingKey === "settings") {
      audioPreview.stop();
      return;
    }
    setTestState("loading");
    setTestError("");
    try {
      const url = await synthesizePreview();
      // 再生失敗（コーデック/自動再生制限など）も握りつぶさず通知する（§2-5）。停止制御は audioPreview に委ねる。
      audioPreview.play("settings", url, () => {
        setTestError("声の確認に失敗しました。もう一度お試しください。");
        setTestState("error");
      });
      setTestState("idle");
    } catch (e) {
      // VOICEVOX 由来の失敗は Rust が行動明示の文で返す（関門を通る）。それ以外は定型文。
      // ⚠️ **見分けるのは「型」ではなく「文の形」**（#1123）＝文字列か `Error` かではなく、
      // **日本語を含み、句点を持つ文**かどうかで決まる。
      setTestError(
        userFacingMessage(e, "voice-test") ?? "声の確認に失敗しました。もう一度お試しください。",
      );
      setTestState("error");
    }
  }

  /** 接続キーを操作したか（済んだら、起動時の読み取りは採らない）。 */
  const settled = useRef(false);

  // 画面に入った時点で接続キーの有無を確認（値は取得しない＝有無のみ）。
  //
  // ⚠️ **確かめられなかったことを黙らない**（#1134 レビュー由来 🟡・§2-5）＝以前は
  // `.catch(() => setAiConnected(false))` と**黙って「未接続」**にしていた。
  // 保存直後の「接続キーは保存できましたが…設定を開き直してご確認ください」に従って開き直しても、
  // 確認がまた失敗すれば**何も言わずに未接続**へ変わる＝直前の案内と食い違い、
  // 利用者は確認できたのかどうかを**見分ける手段が無い**（案内が空手形になる）。
  // ⚠️ **状態は「無い」側へ倒す**＝在ると偽って AI の機能を押させない（押しても進まない、を作らない）。
  useEffect(() => {
    // ⚠️ **あとから来た起動時の結果で、操作の結果を上書きしない**（レビュー由来 ℹ️・
    // `projectStore` の「丸ごと set で並行編集を巻き戻す」と同型）＝保存や削除が先に済んでいたら、
    // 遅れて解決したこの読み取りは**採らない**。
    // ⚠️ **外れたかどうか（`live`）だけでは足りない**＝画面に居るまま遅れて解決する筋がある。
    // **操作が済んだか**（`settled`）で見る。`live` は外れたあとの set を避けるために別に持つ。
    let live = true;
    void hasApiKey(GEMINI_PROVIDER)
      .then((has) => { if (live && !settled.current) setAiConnected(has); })
      .catch((e: unknown) => {
        if (!live || settled.current) return;
        setAiConnected(false);
        // ⚠️ **Rust が理由を返せるなら、それを出す**（#1131）＝`has_api_key` は
        // アクセスできないときに `KEYRING_UNAVAILABLE` を返す（以前は `Ok(false)` に畳んでいた）。
        setKeyError(userFacingMessage(e, "api-key-state") ?? apiKeyMessage.API_KEY_STATE_UNKNOWN);
      });
    return () => { live = false; };
  }, []);

  // ⚠️ **「できなかった」と「確かめられなかった」を分ける**（#1131・ADR-0026①）＝以前は
  // 保存と**状態の確認**を1つの `try` に入れていたので、**保存は成功したのに `hasApiKey` が
  // 投げる**と「キーを保存できませんでした」と出た＝**起きたことと食い違う**。しかも
  // `setKeyInput("")` が先にあったため、**入力欄だけ空**になって利用者は打ち直すことになり、
  // その打ち直しは（実際には保存済みなので）**丸ごと無駄**だった。
  async function onSaveKey() {
    // ⚠️ **ここから先は、起動時の読み取りより新しい**（レビュー由来 ℹ️）。
    settled.current = true;
    setKeyBusy(true);
    setKeyError("");
    try {
      await saveApiKey(GEMINI_PROVIDER, keyInput.trim());
    } catch (e) {
      // ⚠️ **先に押せる状態へ戻す**（レビュー由来 ℹ️）＝この下で投げると「保存中…」のまま
      // 二度と押せなくなる（`finally` の外へ出た経路なので、拾ってくれるものが無い）。
      setKeyBusy(false);
      // ⚠️ **入力は消さない**＝打ち直させる以上、消してはいけない（§2-5）。
      setKeyError(userFacingMessage(e, "api-key-save") ?? apiKeyMessage.API_KEY_SAVE_FAILED);
      return;
    }
    // ここから先は**保存は済んでいる**＝失敗したようには見せない。
    setKeyInput("");
    try {
      setAiConnected(await hasApiKey(GEMINI_PROVIDER));
    } catch (e) {
      // ⚠️ **中身は捨てない**（レビュー由来 🟡）＝画面に出す文は「保存はできた」を守るために
      // こちらのものを使うが、**理由は記録へ流す**（`troubleLogBridge` が運ぶ）。
      // 以前は `catch { … }` で `e` を丸ごと落としており、**調べる材料が減る向き**に倒れていた。
      console.error("[api-key-save] 状態を確かめられませんでした:", e);
      // ⚠️ **「在る」側へ倒す**＝保存できたのだから在る。黙って「未接続」に見せない。
      setAiConnected(true);
      setKeyError(apiKeyMessage.API_KEY_SAVED_UNVERIFIED);
    } finally {
      setKeyBusy(false);
    }
  }

  // ⚠️ **双子の片方だけ直さない**（このリポジトリの不具合の多くはこの型）＝削除側も同じ形で、
  // 削除は成功したのに `hasApiKey` が投げると「接続を削除できませんでした」と出ていた。
  async function onClearKey() {
    // ⚠️ **ここから先は、起動時の読み取りより新しい**（レビュー由来 ℹ️）。
    settled.current = true;
    setKeyBusy(true);
    setKeyError("");
    try {
      await deleteApiKey(GEMINI_PROVIDER);
    } catch (e) {
      setKeyBusy(false);
      setConfirmClearKey(false);
      setKeyError(userFacingMessage(e, "api-key-delete") ?? apiKeyMessage.API_KEY_DELETE_FAILED);
      return;
    }
    try {
      setAiConnected(await hasApiKey(GEMINI_PROVIDER));
    } catch (e) {
      console.error("[api-key-delete] 状態を確かめられませんでした:", e);
      // ⚠️ **「無い」側へ倒す**＝消せたのだから無い。
      setAiConnected(false);
      setKeyError(apiKeyMessage.API_KEY_DELETED_UNVERIFIED);
    } finally {
      setKeyBusy(false);
      setConfirmClearKey(false);
    }
  }

  return (
    <div className="main-scroll">
      <PageHead
        title="設定"
        desc="使用するAIやナレーターの声などを設定できます。"
      />

      <div style={{ maxWidth: 760 }} className="col gap-lg">
        {/* 画面の見た目（ADR-0039・#1108）。⚠️ **動画の絵は変わらない**＝暗くなるのはアプリの枠だけ。 */}
        <div className="card">
          <h2 className="section-title">見た目</h2>
          <p className="page-desc text-pretty">
            アプリの明るさを選べます。暗くしても、作っている動画の色は変わりません。
          </p>
          <div className="segment" role="group" aria-label="見た目" style={{ display: "inline-flex" }}>
            {APPEARANCE_CHOICES.map(([id, label]) => (
              <button key={id} className={appearance === id ? "active" : ""} onClick={() => setAppearance(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 動画案を作るAI（接続キーの保存・削除） */}
        <div className="card">
          <h2 className="section-title">動画案を作るAI</h2>
          <p className="page-desc text-pretty">
            動画案づくりに Google の Gemini を使えます。お持ちの接続キーを、この端末の安全な保管領域に保存します（キーは画面には表示しません）。
          </p>

          <div className="toggle-row">
            <div>
              <span className="field-label" style={{ margin: 0 }}>
                接続の状態
              </span>
              <p className="field-hint" style={{ marginTop: 2 }}>
                {aiConnected
                  ? "接続済み。動画案づくりに使われます。"
                  : "未接続のときは、お試し用の動画案で仕上がりを確認できます。"}
              </p>
            </div>
            <span className={`badge ${aiConnected ? "badge-teal" : "badge-gray"}`}>
              {aiConnected ? "接続済み" : "未接続"}
            </span>
          </div>

          {aiConnected ? (
            confirmClearKey ? (
              <DeleteConfirm
                busy={keyBusy}
                message="接続キーを削除しますか？もう一度使うには、キーを貼り付け直す必要があります。"
                onCancel={() => setConfirmClearKey(false)}
                onConfirm={() => void onClearKey()}
              />
            ) : (
              <button
                className="btn btn-secondary"
                onClick={() => setConfirmClearKey(true)}
                disabled={keyBusy}
              >
                接続を削除する
              </button>
            )
          ) : (
            <div className="field">
              <label className="field-label" htmlFor="aiKey">
                接続キー（Gemini）
              </label>
              <div className="row gap-sm">
                <input
                  id="aiKey"
                  className="input grow"
                  type="password"
                  autoComplete="off"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="接続キーを貼り付け"
                />
                <button
                  className="btn btn-primary"
                  onClick={() => void onSaveKey()}
                  disabled={!keyInput.trim() || keyBusy}
                >
                  {keyBusy ? "保存中…" : "保存する"}
                </button>
              </div>
              <p className="field-hint">
                キーはこの端末の安全な保管領域に保存し、画面・ファイル・送信内容には残しません。
              </p>
            </div>
          )}
          {keyError && (
            <div className="notice notice-warn" role="alert" style={{ marginTop: 8 }}>
              <span>{keyError}</span>
            </div>
          )}

          {/* ⚠️ **普段は触らないものは畳んでおく**（#1032）＝自分で「通常は変更不要です」と
              書いている欄が**先頭で開きっぱなし**で、読み飛ばしを文章でお願いしていた。
              ⚠️ **既定と違う値が入っているときは開いて出す**（PR #1072 レビュー ℹ️）＝
              自分で変えた設定を畳んで出すと見失う（「この場面だけ声の大きさ」・場面の BGM と同じ流儀）。
              ⚠️ **`key` は付けない**＝ここで値を `key` にすると**1文字打つごとに作り直されて焦点が外れる**。
              開閉は描画の1回目だけで決める（入力中に畳んだり開いたりしない）。 */}
          <CollapsibleSection scope={SECTION_SCOPE.settings} title="上級者向け" storageKey="ai-advanced" defaultOpen={aiModel !== DEFAULT_AI_MODEL}>
            <div className="field">
              <label className="field-label" htmlFor="aiModel">
                モデル
              </label>
              <input
                id="aiModel"
                className="input"
                value={aiModel}
                onChange={(e) => onChangeModel(e.target.value)}
                placeholder={DEFAULT_AI_MODEL}
              />
              <p className="field-hint">
                通常は変更不要です（未入力なら {DEFAULT_AI_MODEL} を使います）。無料枠の状況が変わったときだけ、提供元が案内する名前に変えてください。
              </p>
            </div>
            <p className="field-hint mt">※ いまつなげられるのは Gemini だけです。</p>
          </CollapsibleSection>

          <hr className="divider" />
          <p className="field-hint">
            動画案を作る前に、外部AIへ渡す情報の確認画面を必ず表示します。
          </p>
        </div>

        {/* ナレーターの声 */}
        <div className="card">
          <h2 className="section-title">ナレーターの声</h2>
          {/* ⚠️ 「常に」ではない（ADR-0025・#359 で出し方を選べる）。この画面（About）側の表示は
              必須のまま・変わるのは**動画に焼く側**だけ、という線で書き分ける。 */}
          <p className="page-desc text-pretty">
            ここで選んだ声は、これから作るものを含めてすべての動画に使われます。
            選んだ声のクレジット（{creditForSpeaker(speaker)}）は「ソフトについて」に必ず表示されます。動画とプレビューへの出し方（最初と最後だけ・非表示など）は「動画を保存」で選べます。
          </p>

          {/* 既定と違う接続先を入れてあるなら開いて出す（上の注記と同じ理由）。 */}
          <CollapsibleSection scope={SECTION_SCOPE.settings} title="上級者向け" storageKey="voice-advanced" defaultOpen={voicevoxUrl.trim() !== ""}>
            <div className="field">
              <label className="field-label" htmlFor="voicevoxUrl">
                音声ソフトの接続先
              </label>
              <input
                id="voicevoxUrl"
                className="input"
                value={voicevoxUrl}
                onChange={(e) => onChangeUrl(e.target.value)}
                placeholder="http://localhost:50021"
              />
              <p className="field-hint">
                通常は空のままで大丈夫です（標準の接続先を使います）。場所を変えている場合だけ入力してください。
              </p>
            </div>
          </CollapsibleSection>

          <div className="field">
            <label className="field-label" htmlFor="voiceStyle">
              声（キャラクター・スタイル）
            </label>
            <select
              id="voiceStyle"
              className="select"
              value={speaker}
              onChange={(e) => onChangeSpeaker(Number(e.target.value))}
            >
              {VOICE_CATALOG.map((c) => (
                <optgroup key={c.character} label={c.character}>
                  {c.styles.map((s) => (
                    <option key={s.speaker} value={s.speaker}>
                      {c.character}（{s.label}）
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {/* ⚠️ 出し方は選べるようになった（ADR-0025・#359）＝ここで「常時」と言い切ると事実と違う。
                出し方の選択は書き出し画面（`CreditDisplayField`）にあるので、そこへ案内する。 */}
            <p className="field-hint">
              選んだキャラクターの名前を、動画にクレジット表示します。出し方（最初と最後だけ・非表示など）は「動画を保存」で選べます。
            </p>
          </div>

        </div>

        {/* ⚠️ **範囲で分ける**（#1032）＝上のカードは**すべての動画に効く**設定（声・接続先）、
            こちらは**いま開いている動画だけ**の設定。以前は同じカードに混ざっており、
            違いは**末尾の一文だけ**で示していた（先に触ってから読むことになる）。
            ⚠️ **声のまとまりは崩さない**（`06 §15` の並び）＝声 → この動画の読み上げ → 言葉の読み方、の順に置く。 */}
        <div className="card">
          <h2 className="section-title">この動画の読み上げ</h2>
          <p className="page-desc text-pretty">
            話す速さ・声の高さ・抑揚は、いま開いている動画の読み上げにだけ使われます（保存すると残ります）。上の「ナレーターの声」は、これから作るものを含めてすべての動画に効きます。
          </p>

          {/* 話す速さ/高さ/抑揚は updateVoiceSettings＝書き出し中は固定（#570 P1）。生成パラメタなので今回のMP4は不変だが、
              無言 no-op を避けて理由を示す（ADR-0026④）。声のクレジット/接続先/キャラは対象外なので、
              そちらは上のカードに残してある（このバナーもこのカードの中だけ）。 */}
          <ExportLockBanner onNavigate={onNavigate} />
          <div className="field">
            <label className="field-label" htmlFor="speed">
              話す速さ
            </label>
            <input
              id="speed"
              type="range"
              disabled={isExporting}
              min={0}
              max={100}
              value={valueToSlider(voiceSettings.speed ?? SPEED_RANGE.def, SPEED_RANGE)}
              {...dragGroup}
              onChange={(e) =>
                updateVoiceSettings({ speed: sliderToValue(Number(e.target.value), SPEED_RANGE) })
              }
              style={{ width: "100%", accentColor: "var(--color-primary)" }}
            />
            <div className="row-between text-faint text-sm">
              <span>ゆっくり</span>
              <span>はやい</span>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="pitch">
              声の高さ
            </label>
            <input
              id="pitch"
              type="range"
              disabled={isExporting}
              min={0}
              max={100}
              value={valueToSlider(voiceSettings.pitch ?? PITCH_RANGE.def, PITCH_RANGE)}
              {...dragGroup}
              onChange={(e) =>
                updateVoiceSettings({ pitch: sliderToValue(Number(e.target.value), PITCH_RANGE) })
              }
              style={{ width: "100%", accentColor: "var(--color-primary)" }}
            />
            <div className="row-between text-faint text-sm">
              <span>ひくい</span>
              <span>たかい</span>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="intonation">
              抑揚
            </label>
            <input
              id="intonation"
              type="range"
              disabled={isExporting}
              min={0}
              max={100}
              value={valueToSlider(voiceSettings.intonation ?? INTONATION_RANGE.def, INTONATION_RANGE)}
              {...dragGroup}
              onChange={(e) =>
                updateVoiceSettings({
                  intonation: sliderToValue(Number(e.target.value), INTONATION_RANGE),
                })
              }
              style={{ width: "100%", accentColor: "var(--color-primary)" }}
            />
            <div className="row-between text-faint text-sm">
              <span>おだやか</span>
              <span>ゆたか</span>
            </div>
          </div>

          <button
            className="btn btn-secondary btn-icon"
            onClick={() => void onTestVoice()}
            disabled={testState === "loading"}
          >
            {/* 再生/停止は SVG アイコンに統一（Unicode「■」をやめる・#547 P3-1）。読み込み中は無アイコンの状態表示。
                アイコンと文字の間隔は .btn の gap に任せる（他画面の再生/停止ボタンと同じ・余分な空白を挟まない）。 */}
            {audioPreview.playingKey === "settings" ? (
              <><StopIcon size={16} />停止</>
            ) : testState === "loading" ? (
              "確認中…"
            ) : (
              <><PlayIcon size={16} />声を試し聞きする</>
            )}
          </button>
          {testState === "error" && (
            <div className="notice notice-warn" role="alert" style={{ marginTop: 8 }}>
              <span>{testError}</span>
            </div>
          )}
        </div>

        {/* ⚠️ **並びは `06 §15` の順**（α-6 出口監査 🟡26）＝声 → 言葉の読み方 → 文字の形 → 会社の見た目。
            以前は会社の見た目が声の直後に入っており、**声↔読み方**と**文字の形↔会社の見た目**の
            2組がどちらも分断されていた（コメント自身が「声のすぐ下」と書いているのに直下ではなかった）。 */}
        {/* 言葉の読み方（ADR-0037・#350）。ナレーターの声のすぐ下＝声にまつわる設定をひとかたまりにする。 */}
        <ReadingDictSection />
        {/* 持ち込みフォント（ADR-0038・#261）。会社の見た目が既定に使うので、その手前に置く。 */}
        <UserFontSection />
        {/* 会社の見た目（ブランドキット・ADR-0036・#351）。 */}
        <BrandKitSection onNavigate={onNavigate} />

        {/* うまくいかないときの記録（#396）。⚠️ **いちばん下**＝ふだんは使わない導線なので、
            日常の設定（声・読み方・文字の形・会社の見た目）の後ろに置く。 */}
        <TroubleLogSection />

        {/* H.264動画保存機能の「OpenH264フォールバック」情報。主経路は Windows 標準機能（Media Foundation）＝ADR-0013。通常＋開発中は機能フラグで既定非表示。 */}
        {OPENH264_FEATURE_ENABLED && (
          <div className="card">
            <h2 className="section-title">動画保存の予備機能</h2>
            <p className="page-desc text-pretty">
              通常は Windows の標準機能で動画を保存します。以下は予備の保存方法が使えるかどうかの状態です。
            </p>
            <div className="row-between mt">
              <span className="text-muted">状態</span>
              <strong>{H264_STATUS_LABEL[h264Status]}</strong>
            </div>
            {h264Status === "error" && (
              <p className="field-hint mt">もう一度お試しのうえ、解決しない場合はアプリを再起動してください。</p>
            )}
            {h264Status === "verificationRequired" && (
              <p className="field-hint mt">ご利用には確認が必要です。アプリを再起動してください。</p>
            )}
            <p className="field-hint mt">{OPENH264_CREDIT_TEXT}</p>
            <details style={{ marginTop: "var(--gap-sm)" }}>
              <summary className="text-sm text-muted" style={{ cursor: "pointer" }}>詳細情報</summary>
              <div className="col gap-sm mt text-sm">
                <div className="row-between"><span className="text-muted">動画の形式</span><span>OpenH264（H.264）</span></div>
                <div className="row-between"><span className="text-muted">提供元</span><span>Cisco Systems, Inc.</span></div>
                <div className="row-between"><span className="text-muted">バージョン</span><span>—</span></div>
                <div className="row-between"><span className="text-muted">検証結果</span><span>—</span></div>
                <div className="row-between"><span className="text-muted">配置場所</span><span>—</span></div>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}

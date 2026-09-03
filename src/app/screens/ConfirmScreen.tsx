import { useEffect, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { willSendExternally } from "../../infrastructure/aiClient";
import { generalPurposeOptions, purposeOptions } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { ASSET_TYPE, VIDEO_KIND } from "../../domain/enums";
import { assetSentText, selectAssetsForSend } from "../../domain/ai/assetSendText";
import { assetTypeLabel, omittedAssetsNote, REGENERATE_OVERWRITE_CONFIRM, sentAssetTextSummary } from "../uiLabels";
import { SparkleIcon, CheckIcon } from "../components/icons";

interface ConfirmProps {
  onNavigate: (screen: ScreenId) => void;
}

export function ConfirmScreen({ onNavigate }: ConfirmProps) {
  // 「キャンセル」の戻り先を確定（#423）。既定はウィザード、たたき台の「作り直す」起点は "draft"。
  // マウント時に一度きりのペイロード（confirmReturnTo）を読み取り、消費して持ち越さない（editingSceneId と同方式）。
  const [returnTo] = useState<ScreenId>(() => useProjectStore.getState().confirmReturnTo ?? "wizard");
  useEffect(() => {
    useProjectStore.getState().setConfirmReturnTo(null);
  }, []);
  const videoKind = useProjectStore((s) => s.meta.videoKind);
  // ⚠️ **作り直すと入れ替わる**ので、いま場面があるかを見る（#985 レビュー 🔴）。
  const scenes = useProjectStore((s) => s.scenes);
  const companyInfo = useProjectStore((s) => s.meta.companyInfo);
  const generalBrief = useProjectStore((s) => s.meta.generalBrief);
  const toneSettings = useProjectStore((s) => s.meta.toneSettings);
  // 自由記述はトップレベル（両用途共通・ADR-0011）。
  const additionalNotes = useProjectStore((s) => s.meta.additionalNotes);
  const purpose = useProjectStore((s) => s.meta.purpose);
  const assets = useProjectStore((s) => s.assets);
  // 素材が多いときは上位 N 件だけ送る（12§6・#585）。**プロンプトと同じ選定関数**を通すので、ここに出るのは
  // 常に「本当に送る分」＝確認画面が嘘にならない（ADR-0026②）。送らない分は下で件数を明示する（無言の打ち切りをしない）。
  const { sent: sentAssets, omitted: omittedAssets } = selectAssetsForSend(assets);
  // 件数の要約も**送る分**で数える（全件で数えると「写真10件」と出しながら8件しか送らない、が起きる・§2-6）。
  const photoCount = sentAssets.filter((a) => a.assetType === ASSET_TYPE.image).length;
  const videoCount = sentAssets.filter((a) => a.assetType === ASSET_TYPE.video).length;
  // ゆうこ・ロゴ等（写真/動画以外）も送るので件数に含める＝要約と展開一覧が食い違わない（§2-6・#547 P2-8 レビュー）。
  const otherCount = sentAssets.length - photoCount - videoCount;
  // 実際に送るテキスト（プロンプトの assetBlock と同じ参照元＝見せた内容と送る内容がズレない・§2-6）。
  // 名前（ファイル名）は素材ごとに必ず送るので、説明・タグが無い素材も**1件ずつ名前を見せる**
  // ＝人名入りファイル名（例「田中さん.jpg」）を最後の送信ゲートで確認できる（件数集約にしない・#547 P2-8 レビュー）。
  const sentTexts = sentAssets.map(assetSentText);
  const [showAssetText, setShowAssetText] = useState(false);
  /**
   * 本当に外へ送るか（#995 ④）。
   *
   * ⚠️ **送らないのに「送信してよい内容か」と聞いていた**＝既定（Mock）では**何も送らない**のに、
   * 「ゆうこに渡して」「送信してよい内容か、もう一度ご確認ください」が出ていた。
   * たたき台の「作り直す」は同じ判定（`willSendExternally`）で確認を飛ばすのに、
   * ウィザードの最終段は**常に**ここへ来る＝**同じ概念の挙動が経路で割れていた**（ADR-0026②）。
   *
   * ⚠️ **確認そのものは残す**（§2-6＝外部送信は事前確認必須）＝変えるのは**言い方**だけ。
   * ⚠️ **判定できないうちは「送る」側**（fail-closed）＝`willSendExternally` が答える前に
   * 「送りません」と見せると、実際は送る場合に**注意を読ませないまま通す**。
   */
  const [external, setExternal] = useState(true);
  useEffect(() => {
    let alive = true;
    void willSendExternally()
      .then((v) => { if (alive) setExternal(v); })
      .catch(() => { /* 判定できないときは「送る」側のまま（fail-closed） */ });
    return () => { alive = false; };
  }, []);
  const isGeneral = videoKind === VIDEO_KIND.general;
  // 目的の表示名は採用/一般どちらの選択肢からも引く（混在しても1件だけ一致する）。
  const purposeLabel =
    [...purposeOptions, ...generalPurposeOptions].find((p) => p.id === purpose)?.label ?? "未設定";

  return (
    <div className="main-scroll">
      <div className="modal-overlay" style={{ position: "static", padding: 0 }}>
        <div className="modal" style={{ maxWidth: 680 }}>
          <div className="text-center mb">
            <div
              className="action-card-icon"
              style={{
                background: "var(--color-yellow)",
                color: "var(--color-warn)",
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
              {external
                ? "下の情報をゆうこに渡して、動画のたたき台を作ります。内容を確認してください。"
                : "下の情報から、動画のたたき台を作ります。内容を確認してください。この内容が外へ送られることはありません。"}
            </p>
          </div>

          {/* 送信される情報 */}
          <div className="card card-tight mb">
            <h2 className="field-label">ゆうこに渡す情報（文字のみ）</h2>
            <div className="col gap-sm mt">
              {isGeneral ? (
                <div className="row-between" style={{ alignItems: "flex-start", gap: "var(--gap-md)" }}>
                  <span className="text-muted">動画のテーマ</span>
                  <strong style={{ textAlign: "right", maxWidth: "70%" }}>
                    {generalBrief?.title || "（未入力）"}
                    {generalBrief?.agenda?.length ? `（構成${generalBrief.agenda.length}項目）` : ""}
                  </strong>
                </div>
              ) : (
                <div className="row-between">
                  <span className="text-muted">会社情報</span>
                  <strong>
                    {companyInfo?.companyName}
                    {companyInfo?.industry ? `（${companyInfo.industry}）` : ""}
                  </strong>
                </div>
              )}
              <hr className="divider" style={{ margin: "4px 0" }} />
              <div className="row-between">
                <span className="text-muted">動画の目的</span>
                <strong>{purposeLabel}</strong>
              </div>
              {isGeneral && (generalBrief?.targetAudience || toneSettings?.tone) && (
                <>
                  <hr className="divider" style={{ margin: "4px 0" }} />
                  <div className="row-between">
                    <span className="text-muted">対象・トーン</span>
                    <strong style={{ textAlign: "right", maxWidth: "70%" }}>
                      {generalBrief?.targetAudience || "（指定なし）"}
                      {toneSettings?.tone ? `／${toneSettings.tone}` : ""}
                    </strong>
                  </div>
                </>
              )}
              <hr className="divider" style={{ margin: "4px 0" }} />
              <div className="row-between" style={{ alignItems: "flex-start", gap: "var(--gap-md)" }}>
                <span className="text-muted">素材の説明・タグ</span>
                <div style={{ textAlign: "right", maxWidth: "70%" }}>
                  <strong>{sentAssetTextSummary(photoCount, videoCount, otherCount) || "（素材はありません）"}</strong>
                  {/* 素材が多くて送りきれない分は**黙って切らず**件数と理由と次の行動を出す（12§6・§2-5・#585）。 */}
                  {omittedAssets.length > 0 && (
                    <div className="text-sm" style={{ marginTop: 4 }}>{omittedAssetsNote(omittedAssets.length)}</div>
                  )}
                  {/* §2-6：件数だけでなく**実際に送る文字**を見せる（#547 P2-8）。個人情報の確認は中身を見ないとできない。 */}
                  {sentTexts.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-ghost text-sm"
                      style={{ marginTop: 4 }}
                      onClick={() => setShowAssetText((v) => !v)}
                      aria-expanded={showAssetText}
                    >
                      {showAssetText ? "文字情報を隠す" : external ? "送る文字情報を確認する" : "使う文字情報を確認する"}
                    </button>
                  )}
                </div>
              </div>
              {showAssetText && (
                <ul className="col gap-sm" style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
                  {sentTexts.map((t) => (
                    <li key={t.assetId} className="card card-tight" style={{ textAlign: "left" }}>
                      {/* 種別は正しいラベルで（写真/動画に畳まない＝ロゴ・QRコード等も実体どおり・§2-3）。 */}
                      <div className="text-sm" style={{ fontWeight: 600 }}>
                        {assetTypeLabel[t.assetType]}：{t.name || "（名前なし）"}
                      </div>
                      {t.description && (
                        <div className="text-sm" style={{ whiteSpace: "pre-wrap" }}>説明：{t.description}</div>
                      )}
                      {t.aiDescription && (
                        <div className="text-sm text-muted" style={{ whiteSpace: "pre-wrap" }}>AI解析：{t.aiDescription}</div>
                      )}
                      {t.tags.length > 0 && <div className="text-sm text-muted">タグ：{t.tags.join("、")}</div>}
                    </li>
                  ))}
                </ul>
              )}
              {additionalNotes?.trim() && (
                <>
                  <hr className="divider" style={{ margin: "4px 0" }} />
                  <div className="row-between" style={{ alignItems: "flex-start", gap: "var(--gap-md)" }}>
                    <span className="text-muted">補足（その他）</span>
                    <strong style={{ textAlign: "right", maxWidth: "70%", whiteSpace: "pre-wrap" }}>
                      {additionalNotes}
                    </strong>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 強調: 写真・動画ファイルは送信しない（MVP は文字情報のみ） */}
          {/* ⚠️ **送るときの話は、送るときだけ**（#995 ④・PR #1027 レビュー 🔴）＝
              送らないのに「渡します」「送信しません」と言うと、**送っている前提**の説明になる。 */}
          <div className="notice notice-strong mb">
            <CheckIcon size={18} />
            <span>
              {external ? (
                <>
                  写真や動画のファイルそのものは送信しません。入力いただいた内容と、素材につけた
                  説明・タグなどの<strong>文字情報だけ</strong>をゆうこに渡します。
                </>
              ) : (
                <>
                  この動画のたたき台は、<strong>この端末の中だけ</strong>で作ります。
                  入力いただいた内容も素材も、外へ送られることはありません。
                </>
              )}
            </span>
          </div>

          {/* 個人情報の注意（§2-6）。⚠️ **送るときだけ出す**（#995 ④）＝送らないのに
              「送信してよい内容か」と聞くと、注意の重みが薄まる（毎回出る警告は読まれなくなる）。 */}
          {external && (
            <div className="notice notice-warn mb">
              <span>
                人物が写っている素材の説明などには、個人情報が含まれることがあります。
                送信してよい内容か、もう一度ご確認ください。
              </span>
            </div>
          )}

          {/* ボタン（送信前確認は §2-6 で毎回必須＝「次回から表示しない」は設けない） */}
          {/* ⚠️ **押す前に、何が起きるかを告げる**（#985 レビュー 🔴）＝作り直すと
              **いまの場面は入れ替わる**。もとはたたき台の「作り直す」にしか確認が無く、
              **入れた内容を見直す道（#985）を通ると、場面が黙って消えた**。
              ⚠️ **ここでは「はい/いいえ」を二重に聞かない**＝たたき台から来た人は既に答えている。
              **作る手前に必ず目に入る**ことが要件なので、告げるだけにする（主ボタンが答えになる）。 */}
          {scenes.length > 0 && (
            <div className="notice notice-warn mb" role="alert">
              <span>{REGENERATE_OVERWRITE_CONFIRM}</span>
            </div>
          )}
          <div className="row gap-sm mt-lg">
            <button
              className="btn btn-ghost grow"
              onClick={() => onNavigate(returnTo)}
            >
              キャンセル
            </button>
            <button
              className="btn btn-primary grow btn-lg"
              onClick={() => onNavigate("generating")}
            >
              <SparkleIcon size={20} />
              {/* ⚠️ **いちばん目立つ所こそ、実際に起きることを言う**（PR #1027 レビュー 🔴）＝
                  送らないのに「送信して」と書くと、**この画面で直したはずのことが主ボタンに残る**。 */}
              {external ? "送信して動画案を作る" : "この内容で動画案を作る"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

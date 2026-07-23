import { useEffect, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { generalPurposeOptions, purposeOptions } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { ASSET_TYPE, VIDEO_KIND } from "../../domain/enums";
import { assetSentText } from "../../domain/ai/assetSendText";
import { assetTypeLabel, sentAssetTextSummary } from "../uiLabels";
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
  const companyInfo = useProjectStore((s) => s.meta.companyInfo);
  const generalBrief = useProjectStore((s) => s.meta.generalBrief);
  const toneSettings = useProjectStore((s) => s.meta.toneSettings);
  // 自由記述はトップレベル（両用途共通・ADR-0011）。
  const additionalNotes = useProjectStore((s) => s.meta.additionalNotes);
  const purpose = useProjectStore((s) => s.meta.purpose);
  const assets = useProjectStore((s) => s.assets);
  const photoCount = assets.filter((a) => a.assetType === ASSET_TYPE.image).length;
  const videoCount = assets.filter((a) => a.assetType === ASSET_TYPE.video).length;
  // ゆうこ・ロゴ等（写真/動画以外）も送るので件数に含める＝要約と展開一覧が食い違わない（§2-6・#547 P2-8 レビュー）。
  const otherCount = assets.length - photoCount - videoCount;
  // 実際に送るテキスト（プロンプトの assetBlock と同じ参照元＝見せた内容と送る内容がズレない・§2-6）。
  // 名前（ファイル名）は素材ごとに必ず送るので、説明・タグが無い素材も**1件ずつ名前を見せる**
  // ＝人名入りファイル名（例「田中さん.jpg」）を最後の送信ゲートで確認できる（件数集約にしない・#547 P2-8 レビュー）。
  const sentTexts = assets.map(assetSentText);
  const [showAssetText, setShowAssetText] = useState(false);
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
              下の情報をゆうこに渡して、動画のたたき台を作ります。内容を確認してください。
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
                  {/* §2-6：件数だけでなく**実際に送る文字**を見せる（#547 P2-8）。個人情報の確認は中身を見ないとできない。 */}
                  {sentTexts.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-ghost text-sm"
                      style={{ marginTop: 4 }}
                      onClick={() => setShowAssetText((v) => !v)}
                      aria-expanded={showAssetText}
                    >
                      {showAssetText ? "文字情報を隠す" : "送る文字情報を確認する"}
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
          <div className="notice notice-strong mb">
            <CheckIcon size={18} />
            <span>
              写真や動画のファイルそのものは送信しません。入力いただいた内容と、素材につけた
              説明・タグなどの<strong>文字情報だけ</strong>をゆうこに渡します。
            </span>
          </div>

          {/* 個人情報の注意（§2-6） */}
          <div className="notice notice-warn mb">
            <span>
              人物が写っている素材の説明などには、個人情報が含まれることがあります。
              送信してよい内容か、もう一度ご確認ください。
            </span>
          </div>

          {/* ボタン（送信前確認は §2-6 で毎回必須＝「次回から表示しない」は設けない） */}
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
              送信して動画案を作る
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

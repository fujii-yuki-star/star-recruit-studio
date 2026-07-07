import { useEffect, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { generalPurposeOptions, purposeOptions } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { ASSET_TYPE, VIDEO_KIND } from "../../domain/enums";
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
              <div className="row-between">
                <span className="text-muted">素材の説明・タグ</span>
                <strong>
                  写真{photoCount}枚・動画{videoCount}本ぶんの文字情報
                </strong>
              </div>
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

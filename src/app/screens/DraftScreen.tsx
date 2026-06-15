import { useEffect, useState } from "react";
import type { ScreenId } from "../data/mockData";
import { useProjectStore } from "../store/projectStore";
import { sceneToDraftRow, warningsToDraftWarnings } from "../adapters";
import { PageHead } from "../components/ui";
import { WarningBanner, VoiceStatusBadge, EmptyState } from "../components/states";
import { YukoPanel } from "../components/YukoPanel";
import {
  CheckIcon,
  SparkleIcon,
  PlusIcon,
  TrashIcon,
  PlayIcon,
  PhotoIcon,
  VideoIcon,
} from "../components/icons";

interface DraftProps {
  onNavigate: (screen: ScreenId) => void;
}

export function DraftScreen({ onNavigate }: DraftProps) {
  const { status, scenes, parts, templates, assets, warnings, generate, addScene, removeScene, moveScene, duplicateScene } =
    useProjectStore();
  // 行ごと削除の二段確認（誤操作防止）。確認中の行 id。
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // たたき台へ直接来た場合は生成する（本実装では保存済みプロジェクトの読込に置き換え）
  useEffect(() => {
    if (status === "idle") void generate();
  }, [status, generate]);

  const rows = scenes.map((s) => sceneToDraftRow(s, parts, templates, assets));
  const draftWarnings = warningsToDraftWarnings(warnings);

  if (rows.length === 0) {
    return (
      <div className="main-scroll">
        <PageHead title="動画のたたき台を確認" desc="ゆうこが作った構成を、台本表で確認・修正できます。" />
        <EmptyState
          title={status === "generating" ? "動画案を作成中です…" : "まだ動画案がありません"}
          message="「新しい動画を作る」から、会社情報と素材を入れて動画案を作成しましょう。"
          action={
            <button className="btn btn-primary" onClick={() => onNavigate("wizard")}>
              新しい動画を作る
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="main-scroll">
      <div className="content-with-yuko">
        <div>
          <PageHead
            title="動画のたたき台を確認"
            desc="ゆうこが作った構成です。台本表を見ながら、自由に修正してください。"
          />

          {/* 注意書き */}
          <div className="notice notice-warn mb">
            <SparkleIcon size={18} />
            <span>
              このたたき台はゆうこ（AI）が作成したものです。必要に応じて自由に修正してください。
            </span>
          </div>

          {/* 自動補正・確認の通知 */}
          <WarningBanner warnings={draftWarnings} />

          {/* 台本表 */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>順番</th>
                  <th>パート</th>
                  <th>場面</th>
                  <th>使う素材</th>
                  <th style={{ minWidth: 240 }}>ゆうこのセリフ</th>
                  <th>見た目</th>
                  <th>音声</th>
                  <th style={{ width: 210 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.id}>
                    <td className="table-num">{row.order}</td>
                    <td>
                      <strong>{row.part}</strong>
                    </td>
                    <td>{row.scene}</td>
                    <td>
                      <span className="row gap-sm">
                        {row.materialType === "video" ? (
                          <VideoIcon size={16} className="text-faint" />
                        ) : (
                          <PhotoIcon size={16} className="text-faint" />
                        )}
                        {row.material}
                      </span>
                    </td>
                    <td className="text-pretty">{row.line}</td>
                    <td>
                      <span className="badge badge-teal">{row.look}</span>
                    </td>
                    <td>
                      <VoiceStatusBadge status={row.voiceStatus} />
                    </td>
                    <td>
                      <div className="row gap-sm row-wrap">
                        <button
                          className="btn btn-ghost btn-icon"
                          title="上へ移動"
                          aria-label="上へ移動"
                          disabled={i === 0}
                          onClick={() => moveScene(row.id, "up")}
                        >
                          ↑
                        </button>
                        <button
                          className="btn btn-ghost btn-icon"
                          title="下へ移動"
                          aria-label="下へ移動"
                          disabled={i === rows.length - 1}
                          onClick={() => moveScene(row.id, "down")}
                        >
                          ↓
                        </button>
                        <button
                          className="btn btn-ghost btn-icon"
                          title="この場面を複製"
                          aria-label="この場面を複製"
                          onClick={() => duplicateScene(row.id)}
                        >
                          複製
                        </button>
                        <button className="btn btn-ghost btn-icon" title="セリフを直す" onClick={() => onNavigate("scene-edit")}>
                          セリフ
                        </button>
                        <button className="btn btn-ghost btn-icon" title="素材を変更" onClick={() => onNavigate("scene-edit")}>
                          素材
                        </button>
                        <button className="btn btn-ghost btn-icon" title="見た目を変更" onClick={() => onNavigate("scene-edit")}>
                          見た目
                        </button>
                        {confirmId === row.id ? (
                          <>
                            <button
                              className="btn btn-danger btn-icon"
                              onClick={() => {
                                removeScene(row.id);
                                setConfirmId(null);
                              }}
                            >
                              削除する
                            </button>
                            <button className="btn btn-ghost btn-icon" onClick={() => setConfirmId(null)}>
                              やめる
                            </button>
                          </>
                        ) : (
                          <button
                            className="btn btn-ghost btn-icon"
                            style={{ color: "var(--color-danger)" }}
                            title="この場面を削除"
                            aria-label="この場面を削除"
                            onClick={() => setConfirmId(row.id)}
                          >
                            <TrashIcon size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 場面の追加（削除は各行の操作から） */}
          <div className="row gap-sm mt">
            <button className="btn btn-secondary" onClick={() => addScene()}>
              <PlusIcon size={18} />
              場面を追加
            </button>
            <button className="btn btn-ghost" onClick={() => onNavigate("preview")}>
              <PlayIcon size={16} />
              途中まで仕上がり確認
            </button>
          </div>

          {/* 主操作 */}
          <div className="row-between mt-lg">
            <button className="btn btn-secondary" onClick={() => void generate()}>
              <SparkleIcon size={18} />
              作り直す
            </button>
            <button
              className="btn btn-primary btn-lg"
              onClick={() => onNavigate("scene-edit")}
            >
              <CheckIcon size={20} />
              この内容で確認・編集する
            </button>
          </div>
        </div>

        <YukoPanel
          messages={[
            `動画のたたき台ができました！全部で${rows.length}つの場面で構成しています。`,
            "セリフや素材は、表の右の操作ボタンから直せます。",
            "気になるところがなければ「この内容で確認・編集する」に進みましょう。",
          ]}
        />
      </div>
    </div>
  );
}

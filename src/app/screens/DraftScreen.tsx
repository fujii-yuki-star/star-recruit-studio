import type { ScreenId } from "../data/mockData";
import { draftRows, sampleWarnings } from "../data/mockData";
import { PageHead } from "../components/ui";
import { WarningBanner, VoiceStatusBadge } from "../components/states";
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
          <WarningBanner warnings={sampleWarnings} />

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
                  <th style={{ width: 150 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {draftRows.map((row) => (
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
                          title="セリフを直す"
                          onClick={() => onNavigate("scene-edit")}
                        >
                          セリフ
                        </button>
                        <button
                          className="btn btn-ghost btn-icon"
                          title="素材を変更"
                          onClick={() => onNavigate("scene-edit")}
                        >
                          素材
                        </button>
                        <button
                          className="btn btn-ghost btn-icon"
                          title="見た目を変更"
                          onClick={() => onNavigate("scene-edit")}
                        >
                          見た目
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 場面の追加・削除 */}
          <div className="row gap-sm mt">
            <button className="btn btn-secondary" onClick={() => onNavigate("scene-edit")}>
              <PlusIcon size={18} />
              場面を追加
            </button>
            <button className="btn btn-danger">
              <TrashIcon size={18} />
              場面を削除
            </button>
            <button className="btn btn-ghost" onClick={() => onNavigate("preview")}>
              <PlayIcon size={16} />
              途中まで仕上がり確認
            </button>
          </div>

          {/* 主操作 */}
          <div className="row-between mt-lg">
            <button className="btn btn-secondary">
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
            "動画のたたき台ができました！全部で4つの場面で構成しています。",
            "セリフや素材は、表の右の操作ボタンから直せます。",
            "気になるところがなければ「この内容で確認・編集する」に進みましょう。",
          ]}
        />
      </div>
    </div>
  );
}

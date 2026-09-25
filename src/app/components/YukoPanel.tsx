import { yukoImage, type BundledYukoPose } from "../data/yukoImages";

interface YukoPanelProps {
  title?: string;
  messages: string[];
  /**
   * 出す顔。
   *
   * ⚠️ **同梱ぶんの型に縛る**（PR #1243 レビュー ℹ️）＝`string` にしていたので、
   * 呼び側の綴り違いが**型で落ちず、黙って既定の顔になる**（押しても何も起きないのと同じ質の壊れ方）。
   * この欄はアプリの案内板なので、**素材の自由な `poseTag`（`11 §3.5`）は流れてこない**
   *（流す必要が出たら、そのときに広げる）。
   */
  pose?: BundledYukoPose;
}

/**
 * 右側に表示する「ゆうこからひとこと / アドバイス」パネル。
 *
 * ⚠️ **立ち絵を出す**（#1228）＝ここは長らく**文字の「ゆうこ」だけ**のプレースホルダで、
 * チュートリアル映像を撮って初めて「絵が無い」ことが目に見えた（利用者の指摘）。
 * ⚠️ **絵は飾りなので `alt` は空**＝すぐ下に同じことを言う文（`title`）があり、
 * 読み上げで二度言わせない。
 */
export function YukoPanel({ title = "ゆうこからひとこと", messages, pose }: YukoPanelProps) {
  return (
    <aside className="yuko-panel" aria-label={title}>
      <div className="yuko-avatar">
        <img className="yuko-avatar-img" src={yukoImage(pose)} alt="" />
      </div>
      <div className="yuko-name">{title}</div>
      {messages.map((m, i) => (
        <p className="yuko-bubble" key={i}>
          {m}
        </p>
      ))}
    </aside>
  );
}

import { ASSET_TYPE } from "../../domain/enums";
import { assetTypeLabel } from "../uiLabels";
import { MusicIcon, PhotoIcon, VideoIcon } from "./icons";
import type { Asset } from "../../domain/project/types";

/**
 * 素材の**小さな絵**（無ければ種類のしるし）。
 *
 * ⚠️ **どの行も同じ大きさの枠を持つ**＝絵が出る行だけに枠を付けると、一覧で**名前の位置が揃わず**、
 * 絵の無い行は「まだ読み込めていない」のか「そういう種別」なのか見て分からない（#952）。
 * ⚠️ **絵を出せる種別でも、出せなかったときは印にする**＝そこだけ名前が左へ戻る、を作らない
 *（`asset://` が拒まれる場合＝#942/#945 で実際に起きた）。
 * ⚠️ **単一の参照元**（§2-7）＝もとは素材画面の中だけにあり、**よく使う素材の一覧は自作していた**
 *（#926）ので、同じ概念が2実装になり見た目が割れていた。切り出して両方が同じものを使う。
 */
export function AssetThumb({ type, src, size = 20, box }: {
  type: Asset["assetType"];
  src?: string;
  size?: number;
  /** 正方形で使うときの一辺（px）。未指定＝親の幅いっぱい（素材画面の従来の使い方）。 */
  box?: number;
}) {
  const cls =
    type === ASSET_TYPE.video ? "thumb-video" : type === ASSET_TYPE.bgm ? "thumb-audio" : "thumb-photo";
  const style = box != null
    ? { aspectRatio: "auto", width: box, height: box, flex: "0 0 auto", overflow: "hidden" as const }
    : { aspectRatio: "auto", width: "100%", overflow: "hidden" as const };
  // ⚠️ **絵が無いときは種類を名前でも読めるようにする**（自己点検）＝アイコンだけだと
  // 「動画なのか音楽なのか」が見た目頼りになる。絵があるときは絵が語るので付けない。
  return (
    <div className={`thumb ${cls}`} style={style} title={src ? undefined : assetTypeLabel[type]}>
      {src ? (
        <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <>
          {type === ASSET_TYPE.video && <VideoIcon size={size} />}
          {type === ASSET_TYPE.bgm && <MusicIcon size={size} />}
          {type === ASSET_TYPE.yuko && <span style={{ fontWeight: 700 }}>ゆ</span>}
          {(type === ASSET_TYPE.image ||
            type === ASSET_TYPE.logo ||
            type === ASSET_TYPE.qr ||
            type === ASSET_TYPE.voice) && <PhotoIcon size={size} />}
        </>
      )}
    </div>
  );
}

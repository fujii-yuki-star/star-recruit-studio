// タイムライン形式で**動画の実映像を出す**（#512 段1）。
//
// 場面形式の `SlotVideo`（`ScenePreview`）とは**時間の持ち主が違う**：あちらは「場面の先頭から d 秒後に
// 流し始める」で、こちらは**再生位置（グローバルな時刻）が正**＝つまみで飛ばせる。だから
// 「いまの再生位置なら素材のどこか」を毎回もらい、止まっているときはそのコマで静止する。
//
// ⚠️ **段1 は絵だけ**＝元の音はまだ流れないので**常に消音**（画面がその場で断る＝§2-5）。音は段2。
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { CropAlignX, CropAlignY, Fit } from "../../domain/enums";
import { CROP_ALIGN_DEFAULT_X, CROP_ALIGN_DEFAULT_Y } from "../../domain/enums";
import { fitToObjectFit } from "./fitToObjectFit";

/** 寄せ → CSS の `object-position`（書き出しの `preserveAspectRatio` の前半と対＝`05 §8`）。 */
const ALIGN_X_PCT: Record<CropAlignX, string> = { left: "0%", center: "50%", right: "100%" };
const ALIGN_Y_PCT: Record<CropAlignY, string> = { top: "0%", middle: "50%", bottom: "100%" };

/** 再生中に「ずれた」とみなす幅（秒）。これ以内なら**掛け直さない**＝毎フレーム seek してカクつかせない。 */
const DRIFT_TOLERANCE_SEC = 0.25;

/**
 * 切り抜きの矩形（**動画の座標**）を、その要素の箱に対する `inset()` へ直す（#512 段1 レビュー 🔴）。
 * 外へはみ出す指定は 0 で止める（負の `inset` は「広げる」意味になり、切り抜きが効かなくなる）。
 */
function insetOf(
  rect: { x: number; y: number; w: number; h: number },
  crop: { x: number; y: number; w: number; h: number },
): string {
  const pct = (v: number, base: number): string => `${Math.max(0, (v / base) * 100)}%`;
  return `inset(${pct(crop.y - rect.y, rect.h)} ${pct(rect.x + rect.w - (crop.x + crop.w), rect.w)} ${pct(
    rect.y + rect.h - (crop.y + crop.h),
    rect.h,
  )} ${pct(crop.x - rect.x, rect.w)})`;
}

export function TimelineSlotVideo({
  src, rect, rotation, opacity, fit, align, clipRect, canvas, sourceSec, speed, playing,
}: {
  src: string;
  /** 置き場所（**動画の座標**＝キャンバス基準）。割合への直しはここで行う（呼び出し側で作らない）。 */
  rect: { x: number; y: number; w: number; h: number };
  rotation?: number;
  opacity?: number;
  fit: Fit;
  /** 寄せ（`cropAlign`）＝`cover` で切る側をどこに寄せるか。書き出しの `preserveAspectRatio` と対。 */
  align?: { x?: CropAlignX; y?: CropAlignY };
  /** 切り抜き（`11 §7.6.4.1`）。書き出しは `<g clip-path>` で包むので、実映像にも同じだけ効かせる。 */
  clipRect?: { x: number; y: number; w: number; h: number };
  /** 動画の実寸（切り抜きの矩形を割合へ直すのに使う）。 */
  canvas: { width: number; height: number };
  /** いまの再生位置に対応する**素材の中の秒**（トリム・速さ込み＝書き出しと同じ式から採る）。 */
  sourceSec: number;
  speed: number;
  playing: boolean;
}): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    // 自動再生不可（ポリシー）や非実装（jsdom）でも throw させない＝静止画で見える（§2-5）。
    const seek = (): void => {
      // ⚠️ **再生中は大きくずれたときだけ掛け直す**＝毎回入れると映像が跳ねる。
      const drift = Math.abs(v.currentTime - sourceSec);
      if (!playing || drift > DRIFT_TOLERANCE_SEC) {
        try { v.currentTime = sourceSec; } catch { /* seek 不可なら loadedmetadata で再設定 */ }
      }
      v.playbackRate = speed > 0 ? speed : 1;
      if (playing) {
        try {
          const p = v.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch { /* noop */ }
      } else {
        try { v.pause(); } catch { /* noop */ }
      }
    };
    v.addEventListener("loadedmetadata", seek);
    if (v.readyState >= 1) seek();
    return () => {
      v.removeEventListener("loadedmetadata", seek);
      try { v.pause(); } catch { /* 非実装(jsdom)/停止不可でも無害 */ }
    };
  }, [src, sourceSec, speed, playing]);

  const style: CSSProperties = {
    position: "absolute",
    left: `${(rect.x / canvas.width) * 100}%`,
    top: `${(rect.y / canvas.height) * 100}%`,
    width: `${(rect.w / canvas.width) * 100}%`,
    height: `${(rect.h / canvas.height) * 100}%`,
    // 収め方・寄せは SVG の `preserveAspectRatio` と**同じ意味**に写す（`fitToObjectFit`＝共有）。
    objectFit: fitToObjectFit(fit),
    ...(align?.x != null || align?.y != null
      ? { objectPosition: `${ALIGN_X_PCT[align.x ?? CROP_ALIGN_DEFAULT_X]} ${ALIGN_Y_PCT[align.y ?? CROP_ALIGN_DEFAULT_Y]}` }
      : {}),
    ...(rotation ? { transform: `rotate(${rotation}deg)` } : {}),
    ...(opacity != null && opacity < 1 ? { opacity } : {}),
    // 切り抜きは書き出しが `<g clip-path>` で包むので、こちらも同じ所で切る。
    // ⚠️ **割合の基準は「この要素の箱」**（レビュー 🔴・2観点が同じ例で指摘）＝CSS の `inset()` は
    // 要素のボーダーボックスに対して解ける。切り抜きの矩形は**動画の座標**で来るので、
    // ここで**要素基準へ直す**。キャンバス基準のまま渡すと、部品が画面いっぱいでない限り
    // **別の場所が切れる**（画面いっぱいのときだけ偶然一致するので気づきにくい）。
    ...(clipRect ? { clipPath: insetOf(rect, clipRect) } : {}),
    pointerEvents: "none",
  };
  // ⚠️ **常に消音**（段1）＝元の音はまだ流れない。`muted` を外すのは段2（`useOriginalAudio`）。
  return <video ref={ref} src={src} style={style} muted playsInline preload="auto" />;
}

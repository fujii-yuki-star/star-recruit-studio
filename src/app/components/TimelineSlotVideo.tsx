// タイムライン形式で**動画の実映像を出す**（#512 段1）。
//
// 場面形式の `SlotVideo`（`ScenePreview`）とは**時間の持ち主が違う**：あちらは「場面の先頭から d 秒後に
// 流し始める」で、こちらは**再生位置（グローバルな時刻）が正**＝つまみで飛ばせる。だから
// 「いまの再生位置なら素材のどこか」を毎回もらい、止まっているときはそのコマで静止する。
//
// 元の音（#512 段2）は**鳴らす設定のときだけ**流す＝音量は `useMediaVolume`（場面形式と共有）が効かせる。
import { useEffect, useRef } from "react";
import { useMediaVolume } from "../hooks/useMediaVolume";
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
  src, rect, rotation, opacity, fit, align, clipRect, canvas, sourceSec, speed, playing, audioVolume, audioOnly, onUnplayable,
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
  /**
   * 元の音の音量（#512 段2・`undefined`＝**鳴らさない**）。鳴らすかどうかの判定は domain の
   * `clipOriginalAudio` が持ち、ここは受け取った値を効かせるだけ（規則を画面へ写さない）。
   */
  audioVolume?: number;
  /**
   * **音だけ流す**（#512 段2・レビュー 🟡）＝絵は静止のまま出せない事情があるとき（まとまり全体の
   * フェード中・回した部品の切り抜き）に、音まで黙って消さないための姿。
   * ⚠️ 絵を出さない理由は**合成の仕方が書き出しと違う**ことなので、音には当てはまらない
   *（音は合成しない）＝ここで消すと**聞こえないのに書き出しには入る**というズレになる（ADR-0001）。
   */
  audioOnly?: boolean;
  /**
   * その素材を**この画面では読めなかった**（#512 段1 レビュー 🟡）。
   * ⚠️ 取り込みは変換せずに写すので、**画面が再生できない形式**（HEVC 等）が入りうる。
   * 何も映らない窓を黙って出さないよう、呼び出し側へ知らせて**代表フレームへ戻してもらう**
   * （書き出しは ffmpeg が描くので出る＝「壊れて見える」のは画面だけ）。
   */
  onUnplayable?: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);

  // ⚠️ **合わせるのと、流す・止めるは分ける**（レビュー 🔴・2つのレビューが独立に検出）。
  // 一緒にすると、`sourceSec` は**毎フレーム変わる**（再生位置が動くため）ので effect が張り直され、
  // **後始末の `pause()` → 次の `play()` が毎フレーム**走る＝`play()` の約束が中断され続け、
  // 実機では**映像が進まない／カクつく**（jsdom は `play/pause` を実装しないのでテストに出ない）。

  // (1) 素材の位置を合わせる（流す・止めるはしない）。
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const sync = (): void => {
      // ⚠️ **再生中は大きくずれたときだけ掛け直す**＝毎回入れると映像が跳ねる。
      const drift = Math.abs(v.currentTime - sourceSec);
      if (!playing || drift > DRIFT_TOLERANCE_SEC) {
        try { v.currentTime = sourceSec; } catch { /* seek 不可なら loadedmetadata で再設定 */ }
      }
      v.playbackRate = speed > 0 ? speed : 1;
    };
    v.addEventListener("loadedmetadata", sync);
    if (v.readyState >= 1) sync();
    return () => v.removeEventListener("loadedmetadata", sync);
  }, [src, sourceSec, speed, playing]);

  // (2) 流す・止める。**いまの状態と違うときだけ**触る（同じ命令を毎回投げない）。
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    // 自動再生不可（ポリシー）や非実装（jsdom）でも throw させない＝静止画で見える（§2-5）。
    const apply = (): void => {
      if (playing && v.paused) {
        try {
          const p = v.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        } catch { /* noop */ }
      } else if (!playing && !v.paused) {
        try { v.pause(); } catch { /* noop */ }
      }
    };
    v.addEventListener("loadedmetadata", apply);
    if (v.readyState >= 1) apply();
    return () => v.removeEventListener("loadedmetadata", apply);
  }, [src, playing]);

  // (3) 音量（#512 段2）＝**場面形式と同じ仕組み**（`useMediaVolume`）。100%超は Web Audio で作るので、
  // 書き出し（FFmpeg の `volume`）と一致する。鳴らさない設定（`undefined`）は消音。
  useMediaVolume(ref, { volume: audioVolume ?? 0, muted: audioVolume == null });

  // (4) 画面から消えるときだけ止める（**張り直しでは止めない**＝上の毎フレーム pause を作らない）。
  useEffect(() => {
    const v = ref.current;
    return () => {
      try { v?.pause(); } catch { /* 非実装(jsdom)/停止不可でも無害 */ }
    };
  }, []);

  // 音だけ流すときは**場所を取らない**（見えず・触れず・並びに影響しない）。絵は静止層が担当する。
  const style: CSSProperties = audioOnly
    ? { position: "absolute", width: 0, height: 0, opacity: 0, pointerEvents: "none" }
    : {
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
  // ⚠️ 消音・音量は `useMediaVolume` が要素へ直接効かせる（DOM のプロパティ＝React の属性では届かない）。
  // ここで `muted` を書くと、増幅のために graph へ一本化した音量を要素側から上書きしてしまう。
  return (
    <video
      ref={ref}
      src={src}
      style={style}
      playsInline
      preload="auto"
      // 読めなかったら実映像をやめる（穴だけ開いた窓を残さない）。
      onError={onUnplayable}
    />
  );
}

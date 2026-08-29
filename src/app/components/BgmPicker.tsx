import type { ChangeEvent } from "react";
import { useEffect, useRef } from "react";
import { Switch } from "./ui";
import { useProjectStore } from "../store/projectStore";
import { useHistoryGroup } from "../hooks/useHistoryGroup";
import { BGM_CATALOG } from "../../domain/bgm/bgmCatalog";
import { ASSET_TYPE } from "../../domain/enums";
import { BGM_VOLUME, VOLUME_MAX, VOLUME_MIN, VOLUME_STEP } from "../../domain/constants";

/**
 * BGM の選択UI（標準3曲＋自分のBGM＋音量、入/切）。仕上がり確認で BGM を決められるようにする。
 * bgmSettings（store）を直接読み書きするので、書き出しなど他画面とも設定を共有する。
 *
 * disabled：いまの場面が「個別のBGM」を持つときなど、この全体UIでは変えられない状況で操作を止める（#465 レビュー P1）。
 * note：無効化の理由＋次の行動（例「場面を直す」）。設定できるのに効かない誤認を防ぐ（§2-5）。
 * ※ 場面ごとBGM音量スライダーは未実装だが、将来その画面でも流用できるよう disabled 基盤をここに用意する（#465）。
 */
export function BgmPicker({ disabled = false, note }: { disabled?: boolean; note?: string } = {}) {
  const assets = useProjectStore((s) => s.assets);
  const bgmSettings = useProjectStore((s) => s.meta.bgmSettings);
  const setBgm = useProjectStore((s) => s.setBgm);
  const setBundledBgm = useProjectStore((s) => s.setBundledBgm);
  // ⚠️ **この動画にある音の素材から選べるようにする**（PR #910 レビュー 🟡）＝よく使う素材から
  // 取り込んだ音は `project.assets` に入るだけで、BGM にする導線が無かった（取り込みの案内は
  // 「「動画を保存」のBGMから選べます」と言っているのに**選べない**＝§2-5）。
  const setBgmAsset = useProjectStore((s) => s.setBgmAsset);
  const updateBgmSettings = useProjectStore((s) => s.updateBgmSettings);
  const bgmError = useProjectStore((s) => s.bgmError);
  const clearBgmError = useProjectStore((s) => s.clearBgmError);
  const fileRef = useRef<HTMLInputElement>(null);
  // BGM音量ドラッグ中の連続変更を1履歴にまとめる（#389）。
  const { dragGroup } = useHistoryGroup();

  const bgmAsset = assets.find((a) => a.assetId === bgmSettings?.assetId);
  /** この動画にある音の素材（よく使う素材から取り込んだものもここに出る）。 */
  const bgmAssets = assets.filter((a) => a.assetType === ASSET_TYPE.bgm);
  const withBgm = bgmSettings?.enabled ?? true;

  // 初回表示時、BGM が「入れる」状態で未選択なら標準BGMの先頭を既定にする（確認時にすぐ聴ける）。
  // 明示的に「なし（enabled=false）」にした場合は触らない。
  const didInit = useRef(false);
  useEffect(() => {
    if (disabled) return; // disabled 中は自動初期化しない（書き出し中は setBundledBgm がガードされ、操作していないのに bgmError が出る・#570 P2）。didInit も立てず、解除後に初期化できるようにする。
    if (didInit.current) return;
    didInit.current = true;
    if (bgmSettings?.enabled !== false && !bgmSettings?.bundledBgmId && !bgmAsset) {
      setBundledBgm(BGM_CATALOG[0].id);
    }
  }, [disabled, bgmSettings, bgmAsset, setBundledBgm]);

  function onPickBgm(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") void setBgm({ name: file.name, dataUrl: reader.result });
    };
    reader.readAsDataURL(file);
  }

  return (
    <div style={disabled ? { opacity: 0.6 } : undefined}>
      {disabled && note && <p className="field-hint" style={{ marginTop: 0 }}>{note}</p>}
      <div className="toggle-row">
        <span className="field-label" style={{ margin: 0 }}>
          BGMを入れる
        </span>
        <Switch
          on={withBgm}
          disabled={disabled}
          onChange={(v) => {
            // 初めて入れるとき（未選択）は標準BGMの先頭を既定にする。切るときは選択を保持。
            if (v && !bgmSettings?.bundledBgmId && !bgmAsset) setBundledBgm(BGM_CATALOG[0].id);
            else updateBgmSettings({ enabled: v });
          }}
          label="BGMを入れる"
        />
      </div>
      {withBgm && (
        <div className="field" style={{ marginTop: 8 }}>
          <input ref={fileRef} type="file" accept="audio/*" hidden onChange={onPickBgm} />
          {bgmError && (
            <div className="notice notice-warn" role="alert" style={{ marginBottom: 8 }}>
              <span className="grow">{bgmError}</span>
              <button type="button" className="btn btn-ghost btn-icon text-sm" onClick={clearBgmError}>
                閉じる
              </button>
            </div>
          )}
          <div role="radiogroup" aria-label="標準BGMを選ぶ" style={{ display: "grid", gap: 8 }}>
            {BGM_CATALOG.map((b) => (
              <label key={b.id} className="row gap-sm" style={{ cursor: "pointer", alignItems: "center" }}>
                <input
                  type="radio"
                  name="bgmChoice"
                  checked={bgmSettings?.bundledBgmId === b.id}
                  disabled={disabled}
                  onChange={() => setBundledBgm(b.id)}
                  style={{ accentColor: "var(--color-primary)" }}
                />
                <span className="text-sm">{b.label}</span>
                <span className="text-faint text-sm">— {b.note}</span>
              </label>
            ))}
          </div>
          {/* ⚠️ **この動画にある音の素材からも選べる**（PR #910 レビュー 🟡）＝よく使う素材から取り込んだ音は
              ここに出る。読み込み直さずに使い回せる（ADR-0035 の棚の目的）。 */}
          {bgmAssets.length > 0 && (
            <div className="field" style={{ marginTop: 8 }}>
              <span className="field-label">この動画にある音</span>
              {bgmAssets.map((a) => (
                <label key={a.assetId} className="row gap-sm" style={{ alignItems: "center", cursor: disabled ? "not-allowed" : "pointer" }}>
                  <input
                    type="radio"
                    name="bgmAsset"
                    disabled={disabled}
                    checked={bgmSettings?.assetId === a.assetId && !bgmSettings?.bundledBgmId}
                    onChange={() => setBgmAsset(a.assetId)}
                  />
                  <span className="text-sm">{a.displayName}</span>
                </label>
              ))}
            </div>
          )}
          {/* 標準3曲は単一選択（ラジオ）。自分のBGM は「ファイルを開く操作」なので button にする
              （ラジオだとキーボード選択→ダイアログのキャンセルで未選択に戻り aria 意味論と不一致になるため）。 */}
          <div className="row-between" style={{ marginTop: 8, alignItems: "center" }}>
            {bgmAsset && !bgmSettings?.bundledBgmId ? (
              <span className="text-sm">
                自分のBGM：{bgmAsset.displayName}
                <span className="badge badge-teal" style={{ marginLeft: 6 }}>使用中</span>
              </span>
            ) : (
              <span className="text-sm text-muted">または自分のBGMを使えます</span>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-icon text-sm"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
            >
              {bgmAsset && !bgmSettings?.bundledBgmId ? "BGMを変更する" : "自分のBGMを読み込む"}
            </button>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            <label className="field-label" htmlFor="bgmVolume">
              BGM音量
            </label>
            <input
              id="bgmVolume"
              type="range"
              min={VOLUME_MIN}
              max={VOLUME_MAX}
              step={VOLUME_STEP}
              value={bgmSettings?.volume ?? BGM_VOLUME}
              disabled={disabled}
              {...dragGroup}
              onChange={(e) => updateBgmSettings({ volume: Number(e.target.value) })}
              style={{ width: "100%", accentColor: "var(--color-primary)", ...(disabled ? { cursor: "not-allowed" } : {}) }}
            />
            <div className="row-between text-faint text-sm">
              <span>小さい</span>
              <span>{Math.round((bgmSettings?.volume ?? BGM_VOLUME) * 100)}%（標準25%）</span>
              <span>大きい</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

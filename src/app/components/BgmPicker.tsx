import type { ChangeEvent } from "react";
import { useEffect, useRef } from "react";
import { Switch } from "./ui";
import { useProjectStore } from "../store/projectStore";
import { BGM_CATALOG } from "../../domain/bgm/bgmCatalog";
import { BGM_VOLUME, VOLUME_MAX, VOLUME_MIN, VOLUME_STEP } from "../../domain/constants";

/**
 * BGM の選択UI（標準3曲＋自分のBGM＋音量、入/切）。仕上がり確認で BGM を決められるようにする。
 * bgmSettings（store）を直接読み書きするので、書き出しなど他画面とも設定を共有する。
 */
export function BgmPicker() {
  const assets = useProjectStore((s) => s.assets);
  const bgmSettings = useProjectStore((s) => s.meta.bgmSettings);
  const setBgm = useProjectStore((s) => s.setBgm);
  const setBundledBgm = useProjectStore((s) => s.setBundledBgm);
  const updateBgmSettings = useProjectStore((s) => s.updateBgmSettings);
  const fileRef = useRef<HTMLInputElement>(null);

  const bgmAsset = assets.find((a) => a.assetId === bgmSettings?.assetId);
  const withBgm = bgmSettings?.enabled ?? true;

  // 初回表示時、BGM が「入れる」状態で未選択なら標準BGMの先頭を既定にする（確認時にすぐ聴ける）。
  // 明示的に「なし（enabled=false）」にした場合は触らない。
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (bgmSettings?.enabled !== false && !bgmSettings?.bundledBgmId && !bgmAsset) {
      setBundledBgm(BGM_CATALOG[0].id);
    }
  }, [bgmSettings, bgmAsset, setBundledBgm]);

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
    <div>
      <div className="toggle-row">
        <span className="field-label" style={{ margin: 0 }}>
          BGMを入れる
        </span>
        <Switch
          on={withBgm}
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
          <div role="radiogroup" aria-label="BGMを選ぶ" style={{ display: "grid", gap: 8 }}>
            {BGM_CATALOG.map((b) => (
              <label key={b.id} className="row gap-sm" style={{ cursor: "pointer", alignItems: "center" }}>
                <input
                  type="radio"
                  name="bgmChoice"
                  checked={bgmSettings?.bundledBgmId === b.id}
                  onChange={() => setBundledBgm(b.id)}
                  style={{ accentColor: "var(--color-primary)" }}
                />
                <span className="text-sm">{b.label}</span>
                <span className="text-faint text-sm">— {b.note}</span>
              </label>
            ))}
            <label className="row gap-sm" style={{ cursor: "pointer", alignItems: "center" }}>
              <input
                type="radio"
                name="bgmChoice"
                checked={!!bgmAsset && !bgmSettings?.bundledBgmId}
                onChange={() => fileRef.current?.click()}
                style={{ accentColor: "var(--color-primary)" }}
              />
              <span className="text-sm">自分のBGMを読み込む</span>
            </label>
          </div>
          {bgmAsset && !bgmSettings?.bundledBgmId && (
            <div className="row-between" style={{ marginTop: 6 }}>
              <span className="text-sm text-muted">自分のBGM：{bgmAsset.displayName}</span>
              <button
                type="button"
                className="btn btn-ghost btn-icon text-sm"
                onClick={() => fileRef.current?.click()}
              >
                BGMを変更する
              </button>
            </div>
          )}
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
              onChange={(e) => updateBgmSettings({ volume: Number(e.target.value) })}
              style={{ width: "100%", accentColor: "var(--color-primary)" }}
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

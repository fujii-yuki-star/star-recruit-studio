// 同梱 VOICEVOX ENGINE の dev コピー（target/debug）をハッシュ照合し、壊れたコピーを自動修復する。
// `npm run dev`（tauri dev の beforeDevCommand）前に predev で実行する。
//
// 背景（2026-07-03 の実障害）: Tauri の dev リソースコピーは「サイズ＋更新日時」でしか鮮度を見ないため、
// ビルドと実行が競合してコピーが中断される（os error 32 の時間帯）と、サイズ・日時はそのままに中身だけ
// 壊れたファイルが残り、以後は何度リビルドしても「最新」と判定されて修復されない。実際に
// voicevox_onnxruntime.dll が破損（先頭が 'MZ' でないゴミ）し、エンジンが System32 の onnxruntime.dll へ
// フォールバック→全モデルの読み込みが失敗（CoreError）＝声の生成が全滅した。
//
// 対象はトップレベルの実行ファイル/DLL（run.exe / voicevox_core.dll / voicevox_onnxruntime.dll ≈ 27MB）のみ。
// engine_internal・model（合計 ~2GB）は毎回ハッシュすると dev 起動が遅くなるため対象外（ランタイム層の
// 破損はここで防げる。モデル破損が疑われるときは target/debug/voicevox_engine を丸ごと削除→再コピー）。
// 修復＝壊れたコピーを削除するだけ（次の tauri dev が「無いファイル」として正しく再コピーする）。
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const SRC = join("src-tauri", "resources", "voicevox_engine");
const DST = join("src-tauri", "target", "debug", "voicevox_engine");

// 同梱なし（CI・未配置）や初回（target 未生成）は何もしない＝開発フローを止めない。
if (!existsSync(SRC) || !existsSync(DST)) process.exit(0);

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

let healed = 0;
let checked = 0;
for (const name of readdirSync(SRC)) {
  const src = join(SRC, name);
  const dst = join(DST, name);
  if (!statSync(src).isFile() || !existsSync(dst)) continue; // 無いコピーは tauri dev が作る
  checked += 1;
  if (sha256(src) === sha256(dst)) continue;
  try {
    unlinkSync(dst);
    healed += 1;
    console.warn(`✗ 壊れた ENGINE コピーを削除しました（次の起動で再コピーされます）: ${dst}`);
  } catch (e) {
    // 削除できない＝多くはエンジンが起動中（ファイルロック）。壊れたまま起動しても声は失敗するため明確に止める。
    console.error(`✗ 壊れた ENGINE コピーを修復できませんでした: ${dst}`);
    console.error(`  アプリと VOICEVOX エンジン（run.exe）を終了してから、もう一度お試しください。（${e.message}）`);
    process.exit(1);
  }
}
if (healed > 0) {
  console.log(`✓ voicevox_engine コピー修復 ${healed} 件（照合 ${checked} 件）。次の起動で再コピーされます。`);
} else {
  console.log(`✓ voicevox_engine コピー整合 OK（トップレベル ${checked} 件）`);
}

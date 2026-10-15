// アプリと、アプリのフォルダの下から起動した部品をまとめて止める（録画・下見の道具が終わるとき用）。
//
// ⚠️ **アプリだけを止めると部品が取り残される**（2026-10-15・実際に踏んだ）＝llama-server（このパソコンの中の AI）・
//   run.exe（声）・文字起こしはアプリの子なので、親を強制終了すると後始末が走らず、**丸1日動き続けた**
//   （利用者の別の実測のノイズになった）。
// ⚠️ **フォルダで絞る**＝ほかで動いている同じ名前のもの（利用者が別に起動した VOICEVOX など）は止めない。

/**
 * PowerShell の文を返す。`appDir` はアプリの exe があるフォルダ（絶対パス）。
 * 区切りは `\` にそろえ、その下（`<appDir>\…`）から起動したものだけを止める（フォルダ名の前方一致で隣のフォルダを巻き込まない）。
 */
export function appTreeStopCommand(appDir) {
  const BS = String.fromCharCode(92);
  const dir = String(appDir).split("/").join(BS).replace(/[\\]+$/, "").replace(/'/g, "''");
  return (
    "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and " +
    "$_.ExecutablePath.StartsWith('" + dir + BS + "', [StringComparison]::OrdinalIgnoreCase) } | " +
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
  );
}

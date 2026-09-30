// 配布するものを1つのフォルダに揃える（ADR-0051 未決4 決着＝#1281）。`npm run tauri build` の後に動かす。
//
// ⚠️ **MSI と書庫（`stario1.cab` …）は同じフォルダに無いと入れられない**＝書庫を MSI の外に分けたので
//   （`src-tauri/wix/main.wxs` の MediaTemplate）、Tauri が `bundle/msi/` へ写す MSI だけを配ると入れられない。
//   書庫は WiX の作業場所（`target/release/wix/x64/`）に残るので、ここで MSI と一緒に集める。
// ⚠️ **古い書庫を混ぜない**＝作業場所に前の回の書庫が残っていても拾わない。**MSI 自身が名指しする書庫だけ**を集める
//   （MSI の中の Media 表を読む＝時刻や名前の形で推し量らない。前の回が4つ・今回が3つなら、4つめは入れない）。
//
// 使い方:
//   node scripts/package-release.mjs          … release/stario_<版>/ に MSI・書庫・SHA256SUMS.txt を置く
//   node scripts/package-release.mjs --zip    … さらに release/stario_<版>.zip を作る（Drive へ上げる形）
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
const version = conf.version;
const product = conf.productName ?? 'stario';
const msiName = `${product}_${version}_x64_en-US.msi`;
const msiPath = join(root, 'src-tauri', 'target', 'release', 'bundle', 'msi', msiName);
const wixDir = join(root, 'src-tauri', 'target', 'release', 'wix', 'x64');

if (!existsSync(msiPath)) {
  console.error(`MSI がありません: ${msiPath}（先に npm run tauri build）`);
  process.exit(1);
}
if (!existsSync(wixDir)) {
  console.error(`書庫を作る場所がありません: ${wixDir}（npm run tauri build をやり直してください）`);
  process.exit(1);
}

// MSI が名指しする書庫の名前（Media 表の Cabinet 列）。Windows Installer の COM で読む（Windows 標準・追加の道具なし）。
function cabinetsNamedByMsi(msi) {
  const ps = [
    '$i = New-Object -ComObject WindowsInstaller.Installer',
    `$db = $i.GetType().InvokeMember('OpenDatabase','InvokeMethod',$null,$i,@('${msi.replace(/'/g, "''")}',0))`,
    "$v = $db.GetType().InvokeMember('OpenView','InvokeMethod',$null,$db,@('SELECT `Cabinet` FROM `Media`'))",
    "$v.GetType().InvokeMember('Execute','InvokeMethod',$null,$v,$null) | Out-Null",
    "while ($r = $v.GetType().InvokeMember('Fetch','InvokeMethod',$null,$v,$null)) { $r.GetType().InvokeMember('StringData','GetProperty',$null,$r,1) }",
  ].join('; ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

const named = cabinetsNamedByMsi(msiPath);
if (named === null) {
  console.error('MSI の中身を読めませんでした（Windows で動かしてください）');
  process.exit(1);
}
// 外に置く書庫だけ（MSI の中に埋めたものは名前が '#' で始まる）。
const cabs = named.filter((n) => !n.startsWith('#'));
if (cabs.length === 0) {
  console.error(`MSI が外の書庫を名指ししていません（src-tauri/wix/main.wxs の MediaTemplate を確かめてください）`);
  process.exit(1);
}
const missing = cabs.filter((n) => !existsSync(join(wixDir, n)));
if (missing.length > 0) {
  console.error(`MSI が使う書庫が見つかりません: ${missing.join(', ')}（npm run tauri build をやり直してください）`);
  process.exit(1);
}
for (const n of cabs) {
  // 同じ名前でも前の回の残りなら、MSI と一緒に作られていない＝時刻で念のため見る（MSI より 1 時間以上古いものは止める）。
  if (statSync(join(wixDir, n)).mtimeMs < statSync(msiPath).mtimeMs - 60 * 60 * 1000) {
    console.error(`書庫 ${n} が MSI より古いです（前の回の残り）。npm run tauri build をやり直してください`);
    process.exit(1);
  }
}

const outDir = join(root, 'release', `${product}_${version}`);
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const sha256 = (p) =>
  new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(p).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });

const files = [[msiPath, msiName], ...cabs.map((n) => [join(wixDir, n), n])];
const sums = [];
for (const [src, name] of files) {
  copyFileSync(src, join(outDir, name));
  sums.push(`${await sha256(join(outDir, name))}  ${name}`);
  console.log(`${name}  ${(statSync(join(outDir, name)).size / 1024 / 1024).toFixed(0)} MB`);
}
writeFileSync(join(outDir, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
writeFileSync(
  join(outDir, 'はじめにお読みください.txt'),
  // 先頭に BOM＝古いメモ帳でも文字化けしない。
  '﻿' +
  [
    'すたりおのインストール',
    '',
    `1. このフォルダの中身（${msiName} と stario1.cab など）を、同じフォルダに入れたままにしてください。`,
    `2. ${msiName} をダブルクリックして、画面の案内に従ってください。`,
    '',
    '※ .cab のファイルを消したり、別の場所へ移したりすると、インストールできません。',
    '※ zip の中を開いたまま MSI をダブルクリックすると失敗します。zip を展開してからやり直してください。',
    '',
  ].join('\r\n'),
);
console.log(`\n→ ${outDir}`);

if (process.argv.includes('--zip')) {
  const zip = join(root, 'release', `${product}_${version}.zip`);
  rmSync(zip, { force: true });
  // ⚠️ PowerShell の Compress-Archive は 2GB を超えるファイルで失敗する＝Windows 標準の tar（bsdtar）で zip を作る。
  // ⚠️ Git Bash の tar（GNU）は zip を作れない＝Windows 標準のものを名指しする。
  const winTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  const tar = process.platform === 'win32' && existsSync(winTar) ? winTar : 'tar';
  const r = spawnSync(tar, ['-a', '-c', '-f', zip, '-C', join(root, 'release'), `${product}_${version}`], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('zip を作れませんでした（フォルダはそのまま使えます）');
    process.exit(1);
  }
  console.log(`→ ${zip}  ${(statSync(zip).size / 1024 / 1024).toFixed(0)} MB`);
}

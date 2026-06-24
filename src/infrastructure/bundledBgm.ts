// 同梱BGM(public/bgm/)の読み込み。静的アセットの fetch は infrastructure 層に置く（domain は純粋＝CLAUDE.md §4）。
import { bgmById } from '../domain/bgm/bgmCatalog';

/**
 * 同梱BGM(public/bgm/<fileName>) を data URL として読み込む（書き出しで FFmpeg へ渡す）。
 * 同名パスは Vite が dist/ へ複製し、dev/packaged とも同一オリジンの `/bgm/...` で配信される（CSP connect-src 'self'）。
 * 取得できないときは undefined（呼び出し側で BGM なし扱い）。
 */
export async function readBundledBgmDataUrl(bundledBgmId: string): Promise<string | undefined> {
  const bgm = bgmById(bundledBgmId);
  if (!bgm) return undefined;
  try {
    const res = await fetch(`/bgm/${bgm.fileName}`);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

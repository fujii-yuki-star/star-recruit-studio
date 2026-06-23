import { describe, expect, it } from 'vitest';
import { EXPORT_CAPABILITY_NOTICE, blocksExport, type ExportCapability } from './exportCapability';

const ALL: ExportCapability[] = ['mediaFoundation', 'fallback', 'unavailable', 'toolMissing'];

describe('exportCapability（書き出し能力・#120）', () => {
  it('全状態に label/detail がある', () => {
    ALL.forEach((c) => {
      expect(EXPORT_CAPABILITY_NOTICE[c].label).toBeTruthy();
      expect(EXPORT_CAPABILITY_NOTICE[c].detail).toBeTruthy();
    });
  });

  it('severity：標準=ok／予備=warning／不可系=action', () => {
    expect(EXPORT_CAPABILITY_NOTICE.mediaFoundation.severity).toBe('ok');
    expect(EXPORT_CAPABILITY_NOTICE.fallback.severity).toBe('warning');
    expect(EXPORT_CAPABILITY_NOTICE.unavailable.severity).toBe('action');
    expect(EXPORT_CAPABILITY_NOTICE.toolMissing.severity).toBe('action');
  });

  it('blocksExport：不可系のみ true（fallback は書き出し可能）', () => {
    expect(blocksExport('mediaFoundation')).toBe(false);
    expect(blocksExport('fallback')).toBe(false);
    expect(blocksExport('unavailable')).toBe(true);
    expect(blocksExport('toolMissing')).toBe(true);
  });

  it('Windows N/KN 向けに「メディア機能パック」を案内する（§2-5 次の行動）', () => {
    expect(EXPORT_CAPABILITY_NOTICE.fallback.detail).toContain('メディア機能パック');
    expect(EXPORT_CAPABILITY_NOTICE.unavailable.detail).toContain('メディア機能パック');
  });
});

import { describe, expect, it, vi } from 'vitest';

// wavDurationSec をセンチネル値にモックし、synthesize が返す durationSec が**概算の横流しでなく wavDurationSec の戻り値**に
// 追従することを証明する（#547 P3-3）。概算をそのまま返す旧実装ならこの値にならず落ちる（＝恒真でない）。
vi.mock('../../domain/voice/wavDuration', () => ({ wavDurationSec: vi.fn(() => 42.5) }));

import { MockVoiceProvider } from './mockVoiceProvider';
import { wavDurationSec } from '../../domain/voice/wavDuration';

describe('MockVoiceProvider.synthesize（尺は wavDurationSec 由来・#547 P3-3）', () => {
  it('durationSec は wavDurationSec の戻り値（文字数概算 1.0 でなく実測へ追従）', async () => {
    const { audioDataUrl, durationSec } = await new MockVoiceProvider().synthesize({ text: 'あ', voiceId: 'v', speed: 1, pitch: 0, intonation: 1 });
    expect(durationSec).toBe(42.5); // 概算(=max(1, 0.2)=1.0)ではなく、モックした wavDurationSec の値
    expect(vi.mocked(wavDurationSec)).toHaveBeenCalledWith(audioDataUrl); // 作った WAV を実測している
  });
});

/**
 * Generates real ringtone audio (WAV data URIs) at runtime so calls have a
 * proper looping ringtone / ringback without shipping any asset files.
 */

function encodeWav(samples: Float32Array, sampleRate: number): string {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += bytesPerSample;
  }
  // Base64 encode without blowing the call stack on large buffers.
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  const b64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(binary, "binary").toString("base64");
  return `data:audio/wav;base64,${b64}`;
}

const SAMPLE_RATE = 22050;

/** Classic dual-tone (440 Hz + 480 Hz) ring cadence, safe to loop. */
function buildRing(
  segments: Array<{ on: boolean; seconds: number }>,
  gain: number,
): string {
  const total = segments.reduce((sum, s) => sum + s.seconds, 0);
  const samples = new Float32Array(Math.round(total * SAMPLE_RATE));
  let index = 0;
  for (const seg of segments) {
    const count = Math.round(seg.seconds * SAMPLE_RATE);
    for (let i = 0; i < count; i++, index++) {
      if (!seg.on) {
        samples[index] = 0;
        continue;
      }
      const t = i / SAMPLE_RATE;
      // Short fades keep the loop click-free.
      const fade = Math.min(1, t / 0.01, (seg.seconds - t) / 0.01);
      const value =
        Math.sin(2 * Math.PI * 440 * t) * 0.5 +
        Math.sin(2 * Math.PI * 480 * t) * 0.5;
      samples[index] = value * gain * Math.max(0, fade);
    }
  }
  return encodeWav(samples, SAMPLE_RATE);
}

let ringtoneUri: string | null = null;
let ringbackUri: string | null = null;

/** Incoming-call ringtone: ring · ring · pause (loops seamlessly). */
export function ringtoneDataUri(): string {
  if (!ringtoneUri) {
    ringtoneUri = buildRing(
      [
        { on: true, seconds: 0.4 },
        { on: false, seconds: 0.2 },
        { on: true, seconds: 0.4 },
        { on: false, seconds: 1.6 },
      ],
      0.6,
    );
  }
  return ringtoneUri;
}

/** Outgoing-call ringback the caller hears while the other side rings. */
export function ringbackDataUri(): string {
  if (!ringbackUri) {
    ringbackUri = buildRing(
      [
        { on: true, seconds: 1 },
        { on: false, seconds: 2.5 },
      ],
      0.28,
    );
  }
  return ringbackUri;
}

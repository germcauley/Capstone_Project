/** Minimal PCM WAV decoder (16/24/32-bit int, 32-bit float) to mono Float32. */
export function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");

  let fmt = { format: 1, channels: 1, sampleRate: 44100, bits: 16 };
  let dataOffset = -1;
  let dataLen = 0;
  for (let o = 12; o + 8 <= bytes.length; ) {
    const id = tag(o);
    const size = dv.getUint32(o + 4, true);
    if (id === "fmt ") {
      fmt = {
        format: dv.getUint16(o + 8, true),
        channels: dv.getUint16(o + 10, true),
        sampleRate: dv.getUint32(o + 12, true),
        bits: dv.getUint16(o + 22, true),
      };
      if (fmt.format === 0xfffe) fmt.format = dv.getUint16(o + 32, true); // extensible
    } else if (id === "data") {
      dataOffset = o + 8;
      dataLen = Math.min(size, bytes.length - dataOffset);
      break;
    }
    o += 8 + size + (size % 2);
  }
  if (dataOffset < 0) throw new Error("no data chunk");

  const bytesPer = fmt.bits / 8;
  const frames = Math.floor(dataLen / (bytesPer * fmt.channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const p = dataOffset + (i * fmt.channels + c) * bytesPer;
      let v: number;
      if (fmt.format === 3) v = dv.getFloat32(p, true);
      else if (fmt.bits === 16) v = dv.getInt16(p, true) / 32768;
      else if (fmt.bits === 24) v = ((dv.getUint8(p + 2) << 24) | (dv.getUint8(p + 1) << 16) | (dv.getUint8(p) << 8)) / 2147483648;
      else if (fmt.bits === 32) v = dv.getInt32(p, true) / 2147483648;
      else if (fmt.bits === 8) v = (dv.getUint8(p) - 128) / 128;
      else throw new Error(`unsupported bit depth ${fmt.bits}`);
      acc += v;
    }
    out[i] = acc / fmt.channels;
  }
  return { samples: out, sampleRate: fmt.sampleRate };
}

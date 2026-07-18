export interface PcmWavOptions {
  audioFormat?: number;
  bitsPerSample?: number;
  channels?: number;
  durationSeconds?: number;
  sampleRate?: number;
}

export function makePcmWav(options: PcmWavOptions = {}): Buffer {
  const audioFormat = options.audioFormat ?? 1;
  const bitsPerSample = options.bitsPerSample ?? 16;
  const channels = options.channels ?? 1;
  const durationSeconds = options.durationSeconds ?? 0.1;
  const sampleRate = options.sampleRate ?? 16_000;
  const bytesPerSample = bitsPerSample / 8;
  const dataBytes = Math.floor(sampleRate * channels * bytesPerSample * durationSeconds);
  const buffer = Buffer.alloc(44 + dataBytes);

  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(audioFormat, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);

  return buffer;
}

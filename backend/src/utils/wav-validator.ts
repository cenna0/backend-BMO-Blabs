export interface WavMetadata {
  audioFormat: number;
  bitsPerSample: number;
  channels: number;
  dataBytes: number;
  durationSeconds: number;
  sampleRate: number;
}

function invalidAudio(): never {
  throw new Error("INVALID_AUDIO_FORMAT");
}

function ascii(buffer: Buffer, start: number, end: number): string {
  return buffer.toString("ascii", start, end);
}

export function validateCanonicalWav(buffer: Buffer, maxDurationSeconds: number): WavMetadata {
  if (buffer.length < 44 || ascii(buffer, 0, 4) !== "RIFF" || ascii(buffer, 8, 12) !== "WAVE") {
    return invalidAudio();
  }

  if (buffer.readUInt32LE(4) + 8 !== buffer.length) {
    return invalidAudio();
  }

  let offset = 12;
  let format: Omit<WavMetadata, "dataBytes" | "durationSeconds"> | undefined;
  let dataBytes: number | undefined;
  let byteRate: number | undefined;
  let blockAlign: number | undefined;

  while (offset + 8 <= buffer.length) {
    const chunkId = ascii(buffer, offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const contentStart = offset + 8;
    const contentEnd = contentStart + chunkSize;

    if (contentEnd > buffer.length) {
      return invalidAudio();
    }

    if (chunkId === "fmt ") {
      if (chunkSize < 16) {
        return invalidAudio();
      }
      format = {
        audioFormat: buffer.readUInt16LE(contentStart),
        channels: buffer.readUInt16LE(contentStart + 2),
        sampleRate: buffer.readUInt32LE(contentStart + 4),
        bitsPerSample: buffer.readUInt16LE(contentStart + 14),
      };
      byteRate = buffer.readUInt32LE(contentStart + 8);
      blockAlign = buffer.readUInt16LE(contentStart + 12);
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
    }

    offset = contentEnd + (chunkSize % 2);
  }

  if (!format || dataBytes === undefined || byteRate === undefined || blockAlign === undefined) {
    return invalidAudio();
  }

  const expectedBlockAlign = format.channels * (format.bitsPerSample / 8);
  const expectedByteRate = format.sampleRate * expectedBlockAlign;
  const durationSeconds = dataBytes / expectedByteRate;

  if (
    format.audioFormat !== 1 ||
    format.channels !== 1 ||
    format.sampleRate !== 16_000 ||
    format.bitsPerSample !== 16 ||
    blockAlign !== expectedBlockAlign ||
    byteRate !== expectedByteRate ||
    dataBytes === 0 ||
    dataBytes % blockAlign !== 0 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds > maxDurationSeconds
  ) {
    return invalidAudio();
  }

  return { ...format, dataBytes, durationSeconds };
}

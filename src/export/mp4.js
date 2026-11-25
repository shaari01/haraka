// تصدير MP4 داخل المتصفح: WebCodecs (H.264) + mp4-muxer
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { generateFrames } from './frames.js';

const AVC_CANDIDATES = [
  'avc1.640033', // High 5.1 (حتى 4K)
  'avc1.640028', // High 4.0
  'avc1.4d0028', // Main 4.0
  'avc1.42e028', // Baseline 4.0
  'avc1.42e01f' // Baseline 3.1 (720p)
];

export async function pickVideoCodec(w, h, fps, bitrate) {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const codec of AVC_CANDIDATES) {
    for (const hardwareAcceleration of ['prefer-hardware', 'no-preference', 'prefer-software']) {
      const config = { codec, width: w, height: h, bitrate, framerate: fps, hardwareAcceleration, avc: { format: 'avc' } };
      try {
        const r = await VideoEncoder.isConfigSupported(config);
        if (r.supported) return r.config;
      } catch {}
    }
  }
  return null;
}

export async function canExportMp4(w = 1280, h = 720, fps = 30) {
  return !!(await pickVideoCodec(w, h, fps, 4e6));
}

export function defaultBitrate(w, h, fps) {
  // تقريبًا 0.1 بت لكل بكسل في الإطار، بحد أدنى وأعلى معقولين
  return Math.round(Math.min(40e6, Math.max(2e6, w * h * fps * 0.1)));
}

/**
 * @returns Blob بصيغة video/mp4
 * audio: { buffer: AudioBuffer } اختياري (تضيفه المرحلة السادسة)
 */
export async function exportMp4(project, { w, h, fps, cache, onProgress, signal, motionBlur, audio, bitrate }) {
  bitrate ||= defaultBitrate(w, h, fps);
  const config = await pickVideoCodec(w, h, fps, bitrate);
  if (!config) throw new Error('هذا المتصفح لا يدعم ترميز MP4. استخدم Chrome أو Edge حديثًا، أو صدّر WebM.');

  let audioCfg = null;
  if (audio?.buffer && typeof AudioEncoder !== 'undefined') audioCfg = await pickAudioCodec(audio.buffer);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: w, height: h, frameRate: fps },
    audio: audioCfg ? { codec: audioCfg.muxCodec, sampleRate: audioCfg.sampleRate, numberOfChannels: audioCfg.numberOfChannels } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset'
  });

  let encError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encError = e; }
  });
  encoder.configure(config);

  const frameDur = 1e6 / fps;
  for await (const { canvas, i, total } of generateFrames(project, { fps, w, h, cache, signal, motionBlur })) {
    if (encError) throw encError;
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameDur), duration: Math.round(frameDur) });
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 5));
    onProgress?.((i + 1) / total * (audioCfg ? 0.92 : 1));
  }
  await encoder.flush();
  encoder.close();
  if (encError) throw encError;

  if (audioCfg) {
    await encodeAudio(audio.buffer, audioCfg, muxer, project.duration, audio.offset || 0);
    onProgress?.(1);
  }
  muxer.finalize();
  return new Blob([target.buffer], { type: 'video/mp4' });
}

async function pickAudioCodec(buffer) {
  const sampleRate = buffer.sampleRate;
  const numberOfChannels = Math.min(2, buffer.numberOfChannels);
  const options = [
    { codec: 'mp4a.40.2', muxCodec: 'aac' },
    { codec: 'opus', muxCodec: 'opus' }
  ];
  for (const o of options) {
    for (const sr of [sampleRate, 48000, 44100]) {
      const cfg = { codec: o.codec, sampleRate: sr, numberOfChannels, bitrate: 160000 };
      try {
        const r = await AudioEncoder.isConfigSupported(cfg);
        if (r.supported) return { ...cfg, muxCodec: o.muxCodec };
      } catch {}
    }
  }
  return null;
}

async function encodeAudio(buffer, cfg, muxer, duration, offset) {
  // إعادة المعاينة إلى معدل المرمّز وقص الطول إلى مدة المشروع
  const length = Math.ceil(duration * cfg.sampleRate);
  const off = new OfflineAudioContext(cfg.numberOfChannels, length, cfg.sampleRate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start(Math.max(0, offset), Math.max(0, -offset));
  const rendered = await off.startRendering();
  let err = null;
  const enc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { err = e; } });
  enc.configure({ codec: cfg.codec, sampleRate: cfg.sampleRate, numberOfChannels: cfg.numberOfChannels, bitrate: cfg.bitrate });
  const chunk = 1024 * 4;
  const chans = [];
  for (let c = 0; c < cfg.numberOfChannels; c++) chans.push(rendered.getChannelData(c));
  for (let i = 0; i < length; i += chunk) {
    const n = Math.min(chunk, length - i);
    const data = new Float32Array(n * cfg.numberOfChannels);
    for (let c = 0; c < cfg.numberOfChannels; c++) data.set(chans[c].subarray(i, i + n), c * n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: cfg.sampleRate, numberOfFrames: n, numberOfChannels: cfg.numberOfChannels, timestamp: Math.round(i / cfg.sampleRate * 1e6), data });
    enc.encode(ad);
    ad.close();
  }
  await enc.flush();
  enc.close();
  if (err) throw err;
}

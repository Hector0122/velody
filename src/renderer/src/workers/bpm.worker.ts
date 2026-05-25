// Web Worker: BPM detection via RMS onset + autocorrelation
// Receives mixed audio buffer + sample rate, returns BPM estimate

self.onmessage = (e: MessageEvent<{ mixed: Float32Array; sampleRate: number }>) => {
  const { mixed, sampleRate: sr } = e.data

  const hop = Math.floor(sr * 0.02)
  const frames = Math.floor(Math.min(mixed.length, sr * 60) / hop)

  // RMS envelope
  const rms = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    const start = i * hop
    const end = Math.min(start + hop, mixed.length)
    let sum = 0
    for (let j = start; j < end; j++) sum += mixed[j] * mixed[j]
    rms[i] = Math.sqrt(sum / (end - start))
  }

  // Smooth with 80ms window
  const sw = Math.floor(0.08 / (hop / sr))
  const env = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let s = 0
    let c = 0
    for (let j = i - sw; j <= i + sw; j++) {
      if (j >= 0 && j < frames) {
        s += rms[j]
        c++
      }
    }
    env[i] = s / c
  }

  // Onset: positive diff
  const onset = new Float32Array(frames)
  for (let i = 1; i < frames; i++) onset[i] = Math.max(0, env[i] - env[i - 1])

  // Autocorrelation
  const minLag = Math.floor(((60 / 240) * sr) / hop)
  const maxLag = Math.ceil(((60 / 40) * sr) / hop)
  const acf = new Float32Array(maxLag + 1)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0
    for (let i = 0; i < frames - lag; i++) corr += onset[i] * onset[i + lag]
    acf[lag] = corr / (frames - lag)
  }
  const a0 = acf[0] || 1
  for (let lag = minLag; lag <= maxLag; lag++) acf[lag] /= a0

  // Score candidates with harmonic support
  let bestBpm = 120
  let bestScore = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = Math.round(60 / ((lag * hop) / sr))
    if (bpm < 40 || bpm > 280) continue
    let score = acf[lag]
    for (const mult of [0.5, 2, 3]) {
      const ml = Math.round(lag * mult)
      if (ml >= minLag && ml <= maxLag && acf[ml] > 0) score += acf[ml] * 0.4
    }
    const weight = bpm >= 60 && bpm <= 180 ? 1.2 : 0.8
    score *= weight
    if (score > bestScore) {
      bestScore = score
      bestBpm = bpm
    }
  }

  self.postMessage({ bpm: bestBpm })
}

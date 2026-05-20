import WaveSurfer from 'wavesurfer.js'

export class AudioPlayer {
  private wavesurfer: WaveSurfer | null = null

  async load(container: string, url: string): Promise<void> {
    if (this.wavesurfer) {
      this.wavesurfer.destroy()
    }

    this.wavesurfer = WaveSurfer.create({
      container,
      waveColor: '#4a4a6a',
      progressColor: '#818cf8',
      cursorColor: '#c4b5fd',
      barWidth: 2,
      barGap: 1,
      height: 100
    })

    await this.wavesurfer.load(url)
  }

  play(): void {
    this.wavesurfer?.play()
  }

  pause(): void {
    this.wavesurfer?.pause()
  }

  togglePlay(): void {
    this.wavesurfer?.playPause()
  }

  setVolume(volume: number): void {
    this.wavesurfer?.setVolume(volume)
  }

  getDuration(): number {
    return this.wavesurfer?.getDuration() ?? 0
  }

  getCurrentTime(): number {
    return this.wavesurfer?.getCurrentTime() ?? 0
  }

  destroy(): void {
    this.wavesurfer?.destroy()
    this.wavesurfer = null
  }
}

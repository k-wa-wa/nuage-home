/**
 * Gemini Live から届く 24kHz, 16bit, mono PCM (base64) 音声をシームレスに連続再生するプレイヤー
 */
export class AudioPlayer {
  private audioContext: AudioContext | null = null
  private nextPlayTime = 0
  private activeSources: AudioBufferSourceNode[] = []
  private isPlaying = false
  private onPlayingStateChange?: (playing: boolean) => void

  constructor(onPlayingStateChange?: (playing: boolean) => void) {
    this.onPlayingStateChange = onPlayingStateChange
  }

  get playing(): boolean {
    return this.isPlaying
  }

  private initContext(): AudioContext {
    if (!this.audioContext || this.audioContext.state === "closed") {
      this.audioContext = new AudioContext({ sampleRate: 24000 })
      this.nextPlayTime = this.audioContext.currentTime
    }
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume().catch(() => {})
    }
    return this.audioContext
  }

  /**
   * ユーザージェスチャー（クリック時）に呼び出して AudioContext を有効化する
   */
  async warmup(): Promise<void> {
    const ctx = this.initContext()
    if (ctx.state === "suspended") {
      await ctx.resume()
    }
  }

  /**
   * base64 エンコードされた 24kHz PCM チャンクを受信して再生キューに追加
   */
  queueAudioChunk(base64Pcm: string): void {
    const ctx = this.initContext()

    const binaryString = window.atob(base64Pcm)
    const len = binaryString.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    // 16bit リニア PCM (little-endian) から Float32Array への変換
    const sampleCount = Math.floor(len / 2)
    const int16Array = new Int16Array(bytes.buffer, bytes.byteOffset, sampleCount)
    const float32Array = new Float32Array(sampleCount)
    for (let i = 0; i < sampleCount; i++) {
      float32Array[i] = (int16Array[i] ?? 0) / 32768.0
    }

    const audioBuffer = ctx.createBuffer(1, float32Array.length, 24000)
    audioBuffer.getChannelData(0).set(float32Array)

    const source = ctx.createBufferSource()
    source.buffer = audioBuffer
    source.connect(ctx.destination)

    const currentTime = ctx.currentTime
    // 次の再生時刻が過去になっている場合は現在時刻から少しマージンを取ってリセット
    if (this.nextPlayTime < currentTime) {
      this.nextPlayTime = currentTime + 0.02
    }

    source.start(this.nextPlayTime)
    this.activeSources.push(source)

    if (!this.isPlaying) {
      this.isPlaying = true
      this.onPlayingStateChange?.(true)
    }

    const chunkDuration = audioBuffer.duration
    this.nextPlayTime += chunkDuration

    source.onended = () => {
      const idx = this.activeSources.indexOf(source)
      if (idx !== -1) {
        this.activeSources.splice(idx, 1)
      }
      if (this.activeSources.length === 0) {
        this.isPlaying = false
        this.onPlayingStateChange?.(false)
      }
    }
  }

  /**
   * ユーザーの割り込み（Barge-in）時などに現在再生中および待機中の全音声を即座に停止
   */
  interrupt(): void {
    for (const source of this.activeSources) {
      try {
        source.stop()
        source.disconnect()
      } catch {
        // すでに停止している場合は無視
      }
    }
    this.activeSources = []
    if (this.audioContext) {
      this.nextPlayTime = this.audioContext.currentTime
    }
    if (this.isPlaying) {
      this.isPlaying = false
      this.onPlayingStateChange?.(false)
    }
  }

  /**
   * プレイヤーを破棄・停止する
   */
  destroy(): void {
    this.interrupt()
    if (this.audioContext) {
      this.audioContext.close().catch(() => {})
      this.audioContext = null
    }
  }
}

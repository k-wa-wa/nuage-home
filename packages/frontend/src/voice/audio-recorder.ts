/**
 * 任意の入力サンプリングレートから 16kHz 16bit リニア PCM にダウンサンプリングする
 * エイリアシングノイズを避けるため区間平均フィルタを適用する
 */
function downsampleTo16k(input: Float32Array, inputSampleRate: number): Int16Array {
  if (inputSampleRate === 16000) {
    const output = new Int16Array(input.length)
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]))
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    return output
  }

  const ratio = inputSampleRate / 16000
  const outputLength = Math.round(input.length / ratio)
  const output = new Int16Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(input.length, Math.floor((i + 1) * ratio))
    let sum = 0
    let count = 0
    for (let j = start; j < end; j++) {
      sum += input[j]
      count++
    }
    const avg = count > 0 ? sum / count : (input[start] ?? 0)
    const s = Math.max(-1, Math.min(1, avg))
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }

  return output
}

export interface AudioRecorderCallbacks {
  onAudioChunk: (base64Pcm: string) => void
  onSpeechStart?: () => void
  onSpeechEnd?: () => void
  onSpeechCancel?: () => void
  onLevel?: (rms: number, isSpeaking: boolean) => void
}

/**
 * マイクから音声をキャプチャし、16kHz, 16bit, mono PCM (base64) としてストリーミングするレコーダー
 * クライアント側 VAD（発話開始・終了検知、突発ノイズフィルタ）を備える
 */
export class AudioRecorder {
  private audioContext: AudioContext | null = null
  private mediaStream: MediaStream | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private inputGain: GainNode | null = null
  private muteGain: GainNode | null = null
  private isRecording = false
  private callbacks: AudioRecorderCallbacks
  private isSpeechActive = false
  private consecutiveSpeechFrames = 0
  private totalSpeechFrames = 0
  private silenceFrames = 0
  private noiseFloor = 0.001
  private preRollBuffer: string[] = []

  constructor(callbacks: AudioRecorderCallbacks | ((base64Chunk: string) => void)) {
    if (typeof callbacks === "function") {
      this.callbacks = { onAudioChunk: callbacks }
    } else {
      this.callbacks = callbacks
    }
  }

  async start(): Promise<void> {
    if (this.isRecording) return

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    // ブラウザネイティブのサンプリングレートで初期化（ハードウェアの制限に合致させる）
    this.audioContext = new AudioContext()
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume()
    }

    console.log(`[Recorder] AudioContext running at sampleRate: ${this.audioContext.sampleRate}Hz`)

    this.source = this.audioContext.createMediaStreamSource(this.mediaStream)

    // 入力ゲイン（ノイズ増幅を抑えつつ適正化）
    this.inputGain = this.audioContext.createGain()
    this.inputGain.gain.value = 1.3

    // バッファサイズ 4096（48kHz で約 0.085 秒分、16kHz で約 0.256 秒分）
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1)

    let chunkCount = 0
    this.isSpeechActive = false
    this.consecutiveSpeechFrames = 0
    this.totalSpeechFrames = 0
    this.silenceFrames = 0
    this.preRollBuffer = []

    this.processor.onaudioprocess = (event) => {
      if (!this.isRecording) return
      const inputData = event.inputBuffer.getChannelData(0)

      // 音量チェック（RMS）
      let sum = 0
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i]
      }
      const rms = Math.sqrt(sum / inputData.length)

      // VAD 判定
      // 非発話時のバックグラウンドノイズレベルの緩やかな学習
      if (!this.isSpeechActive && this.consecutiveSpeechFrames === 0) {
        this.noiseFloor = this.noiseFloor * 0.95 + rms * 0.05
      }

      // 発話閾値（突発雑音・環境音を遮断するため最低 0.022、ノイズフロアの約3.5倍）
      const speechThreshold = Math.max(0.022, this.noiseFloor * 3.5)

      // 16kHz PCM にダウンサンプリング
      const pcm16 = downsampleTo16k(inputData, this.audioContext!.sampleRate)
      const base64 = this.arrayBufferToBase64(pcm16.buffer)

      if (rms > speechThreshold) {
        this.silenceFrames = 0
        this.consecutiveSpeechFrames++

        if (!this.isSpeechActive) {
          // 単発ノイズ（打鍵音やクリック音など）を遮断するため、2フレーム以上（約170ms以上）継続した場合のみ発話開始と判定
          if (this.consecutiveSpeechFrames >= 2) {
            this.isSpeechActive = true
            this.totalSpeechFrames = this.consecutiveSpeechFrames
            console.log(`[Recorder] Speech start detected! RMS: ${rms.toFixed(4)} (Threshold: ${speechThreshold.toFixed(4)})`)
            this.callbacks.onSpeechStart?.()

            // プレロール（言葉の頭約250ms）をフラッシュ送信
            for (const prerollChunk of this.preRollBuffer) {
              this.callbacks.onAudioChunk(prerollChunk)
            }
            this.preRollBuffer = []
            this.callbacks.onAudioChunk(base64)
          } else {
            // 判定待ちフレームはプレロールに蓄積
            this.preRollBuffer.push(base64)
            if (this.preRollBuffer.length > 3) {
              this.preRollBuffer.shift()
            }
          }
        } else {
          // 発話中
          this.totalSpeechFrames++
          this.callbacks.onAudioChunk(base64)
        }
      } else {
        // rms <= speechThreshold
        this.consecutiveSpeechFrames = 0

        if (this.isSpeechActive) {
          this.callbacks.onAudioChunk(base64)
          this.silenceFrames++
          // 約 800ms（48kHz 4096サンプルで約 9 フレーム）無音が続いたら発話判定終了
          const silenceLimitFrames = Math.max(5, Math.round((this.audioContext?.sampleRate || 48000) * 0.8 / 4096))
          if (this.silenceFrames >= silenceLimitFrames) {
            const finalTotalFrames = this.totalSpeechFrames
            this.isSpeechActive = false
            this.silenceFrames = 0
            this.consecutiveSpeechFrames = 0
            this.totalSpeechFrames = 0
            this.preRollBuffer = []

            // 総発話時間が 4フレーム（約350ms）未満の場合は単発の雑音（咳や物音）と判定してキャンセル
            if (finalTotalFrames < 4) {
              console.log(`[Recorder] Noise filtered out (too short: ${finalTotalFrames} frames)`)
              this.callbacks.onSpeechCancel?.()
            } else {
              console.log(`[Recorder] Speech end detected (${finalTotalFrames} frames). Triggering turnComplete...`)
              this.callbacks.onSpeechEnd?.()
            }
          }
        } else {
          // 発話待機中は直近 3 チャンク（約250ms）をプレロールバッファに保持
          this.preRollBuffer.push(base64)
          if (this.preRollBuffer.length > 3) {
            this.preRollBuffer.shift()
          }
        }
      }

      chunkCount++
      if (chunkCount % 25 === 0) {
        console.log(`[Recorder] Mic level RMS: ${rms.toFixed(4)} [${this.isSpeechActive ? "TALKING" : "SILENT"}]`)
      }

      this.callbacks.onLevel?.(rms, this.isSpeechActive)
    }

    // ハウリング防止用ミュートゲイン
    this.muteGain = this.audioContext.createGain()
    this.muteGain.gain.value = 0

    this.source.connect(this.inputGain)
    this.inputGain.connect(this.processor)
    this.processor.connect(this.muteGain)
    this.muteGain.connect(this.audioContext.destination)

    this.isRecording = true
  }

  stop(): void {
    // 録音停止時に発話中だった場合は終了コールバックを呼ぶ
    if (this.isSpeechActive) {
      this.isSpeechActive = false
      this.callbacks.onSpeechEnd?.()
    }

    this.isRecording = false

    if (this.processor) {
      this.processor.disconnect()
      this.processor = null
    }

    if (this.inputGain) {
      this.inputGain.disconnect()
      this.inputGain = null
    }

    if (this.muteGain) {
      this.muteGain.disconnect()
      this.muteGain = null
    }

    if (this.source) {
      this.source.disconnect()
      this.source = null
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop())
      this.mediaStream = null
    }

    if (this.audioContext) {
      this.audioContext.close().catch(() => {})
      this.audioContext = null
    }
  }

  /**
   * ArrayBuffer を Base64 文字列に変換
   */
  private arrayBufferToBase64(buffer: ArrayBufferLike): string {
    let binary = ""
    const bytes = new Uint8Array(buffer)
    const len = bytes.byteLength
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return window.btoa(binary)
  }
}

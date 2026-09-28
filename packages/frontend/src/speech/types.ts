/**
 * 音声認識 (STT) の差し替え口。現状は Web Speech API 実装のみで、
 * 将来サーバー側 STT に置き換えるときはこの形を満たす実装を用意する。
 */
export interface SpeechToText {
  onFinal: (text: string) => void
  onInterim: (text: string) => void
  onListeningChange: (listening: boolean) => void
  start(): void
  stop(): void
  /** 自分の発話を拾わないよう、読み上げ中だけ一時停止する */
  suspend(): void
  resume(): void
}

/** 音声合成 (TTS) の差し替え口。読み上げ完了で resolve する */
export interface TextToSpeech {
  speak(text: string): Promise<void>
}

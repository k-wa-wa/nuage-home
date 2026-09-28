import type { TextToSpeech } from "./types.ts"

// 音声合成パラメータのハードコード設定
const RATE = 1.3
const PITCH = 1.0

export class WebSpeechSynthesizer implements TextToSpeech {
  private lang: string

  constructor(lang: string) {
    this.lang = lang
  }

  speak(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = this.lang
      utterance.rate = RATE
      utterance.pitch = PITCH
      utterance.onend = () => resolve()
      utterance.onerror = (event) => reject(new Error(event.error))
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(utterance)
    })
  }
}

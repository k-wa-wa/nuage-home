import "./style.css"
import { config } from "./config.ts"
import { ConversationController, type ConversationView } from "./conversation.ts"
import { OrbRenderer } from "./orb/orb-renderer.ts"
import { WebSpeechRecognizer } from "./speech/web-speech-recognition.ts"
import { WebSpeechSynthesizer } from "./speech/web-speech-synthesis.ts"
import { AgentSocket } from "./ws-client.ts"

const app = document.querySelector<HTMLDivElement>("#app")!
app.innerHTML = `
  <main>
    <canvas id="orb"></canvas>
    <p id="interim"></p>
    <ul id="log"></ul>
  </main>
`

const orbCanvas = document.querySelector<HTMLCanvasElement>("#orb")!
const interimEl = document.querySelector<HTMLParagraphElement>("#interim")!
const logEl = document.querySelector<HTMLUListElement>("#log")!
const orb = new OrbRenderer(orbCanvas)

const view: ConversationView = {
  setState: (state) => orb.setState(state),
  showInterim: (text) => {
    interimEl.textContent = text
  },
  log: (role, text) => {
    const li = document.createElement("li")
    li.textContent = `${role}: ${text}`
    logEl.prepend(li)
  },
}

const agent = new AgentSocket(config.backendWsUrl)
const controller = new ConversationController({
  stt: new WebSpeechRecognizer(config.lang),
  tts: new WebSpeechSynthesizer(config.lang),
  agent,
  view,
})

orbCanvas.addEventListener("click", () => controller.toggle())

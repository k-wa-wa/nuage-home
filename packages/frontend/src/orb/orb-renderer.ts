import FRAGMENT_SRC from "./orb.frag.glsl?raw";
import VERTEX_SRC from "./orb.vert.glsl?raw";

type Rgb = readonly [number, number, number];

/** オーブの見た目の状態 */
export type AssistantState = "stopped" | "listening" | "thinking" | "speaking";

const ENERGY: Readonly<Record<AssistantState, number>> = {
  stopped: 0.08,
  listening: 0.38,
  thinking: 0.72,
  speaking: 1.15,
};

// Clear, high-contrast signature colors so state is instantly recognizable without text:
// - stopped:   Dim, resting slate-gray
// - listening: Bright electric cyan (attentive)
// - thinking:  Vibrant neon purple/violet (processing)
// - speaking:  Luminous emerald green (talking)
const COLOR: Readonly<Record<AssistantState, Rgb>> = {
  stopped: [0.32, 0.38, 0.46],
  listening: [0.1, 0.8, 1.0],
  thinking: [0.85, 0.3, 1.0],
  speaking: [0.15, 1.0, 0.6],
};

// 1 フレームごとに目標値へ近づける割合（状態遷移の速さ）
const EASING = 0.025;

function getAppBgColor(): [number, number, number] {
  try {
    const raw = getComputedStyle(document.body).getPropertyValue("--bg").trim();
    if (raw.startsWith("#")) {
      const hex = raw.slice(1);
      if (hex.length === 6) {
        const val = Number.parseInt(hex, 16);
        return [((val >> 16) & 255) / 255, ((val >> 8) & 255) / 255, (val & 255) / 255];
      }
    }
    const match = raw.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      return [
        Number.parseInt(match[1], 10) / 255,
        Number.parseInt(match[2], 10) / 255,
        Number.parseInt(match[3], 10) / 255,
      ];
    }
  } catch {
    // フォールバック
  }
  return [11 / 255, 13 / 255, 16 / 255];
}

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile error: ${info}`);
  }
  return shader;
}

export class OrbRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private uTime: WebGLUniformLocation;
  private uEnergy: WebGLUniformLocation;
  private uColor: WebGLUniformLocation;
  private uBgColor: WebGLUniformLocation;
  private uResolution: WebGLUniformLocation;
  private uRadius: WebGLUniformLocation;
  private radius = 100;
  private bgColor: [number, number, number] = [11 / 255, 13 / 255, 16 / 255];
  private currentEnergy = ENERGY.stopped;
  private targetEnergy = ENERGY.stopped;
  // 補間で毎フレーム書き換えるので、定数 COLOR を共有せずコピーを持つ
  private currentColor: [number, number, number] = [...COLOR.stopped];
  private targetColor: Rgb = COLOR.stopped;
  private startTime = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl");
    if (!gl) throw new Error("WebGL is not supported in this browser");
    this.gl = gl;

    const program = gl.createProgram()!;
    gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC));
    gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program link error: ${gl.getProgramInfoLog(program)}`);
    }
    gl.useProgram(program);

    // Fullscreen triangle: avoids a second triangle / index buffer for a quad.
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPosition = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    this.uTime = gl.getUniformLocation(program, "uTime")!;
    this.uEnergy = gl.getUniformLocation(program, "uEnergy")!;
    this.uColor = gl.getUniformLocation(program, "uColor")!;
    this.uBgColor = gl.getUniformLocation(program, "uBgColor")!;
    this.uResolution = gl.getUniformLocation(program, "uResolution")!;
    this.uRadius = gl.getUniformLocation(program, "uRadius")!;
    this.bgColor = getAppBgColor();

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.loop();
  }

  setState(state: AssistantState) {
    this.targetEnergy = ENERGY[state];
    this.targetColor = COLOR[state];
  }

  private resize() {
    this.bgColor = getAppBgColor();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.radius = 100 * dpr;
  }

  private loop = () => {
    const gl = this.gl;
    this.currentEnergy += (this.targetEnergy - this.currentEnergy) * EASING;
    for (let i = 0; i < 3; i++) {
      this.currentColor[i] += (this.targetColor[i] - this.currentColor[i]) * EASING;
    }

    gl.uniform1f(this.uTime, (performance.now() - this.startTime) / 1000);
    gl.uniform1f(this.uEnergy, this.currentEnergy);
    gl.uniform3f(this.uColor, this.currentColor[0], this.currentColor[1], this.currentColor[2]);
    gl.uniform3f(this.uBgColor, this.bgColor[0], this.bgColor[1], this.bgColor[2]);
    gl.uniform2f(this.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uRadius, this.radius);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    requestAnimationFrame(this.loop);
  };
}

precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uEnergy;
uniform vec3 uColor;
uniform vec3 uBgColor;
uniform float uRadius;

// Procedural 2D Simplex Noise for ultra-smooth organic fluid motion
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float snoise(vec2 p) {
  const float K1 = 0.366025404; // (sqrt(3)-1)/2
  const float K2 = 0.211324865; // (3-sqrt(3))/6
  vec2 i = floor(p + (p.x + p.y) * K1);
  vec2 a = p - i + (i.x + i.y) * K2;
  vec2 o = step(a.yx, a.xy);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0 * K2;
  vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
  vec3 n = h * h * h * h * vec3(dot(a, hash2(i)), dot(b, hash2(i + o)), dot(c, hash2(i + 1.0)));
  return dot(n, vec3(70.0));
}

float fbm(vec2 p) {
  return 0.65 * snoise(p) + 0.35 * snoise(p * 2.05 + 1.6);
}

void main() {
  vec2 pixelCoord = gl_FragCoord.xy - 0.5 * uResolution.xy;
  float pixelDist = length(pixelCoord);
  float r = pixelDist / uRadius;
  float angle = atan(pixelCoord.y, pixelCoord.x);

  // Time & dynamics: subtle living breathing base + responsive energy
  float t = uTime * (0.85 + 0.65 * uEnergy);
  float breathe = sin(uTime * 1.5) * 0.02 * (0.6 + 0.4 * uEnergy);

  // Seamless 360-degree polar noise sampling (guarantees zero seam/boundary artifact)
  vec2 circleCoord = vec2(cos(angle), sin(angle));

  // Multi-scale organic fluid displacement
  float n1 = fbm(circleCoord * 1.8 + vec2(t * 0.7, t * 0.5));
  float n2 = fbm(circleCoord * 3.4 - vec2(t * 0.6, -t * 0.7) + 3.1);
  float n3 = snoise(circleCoord * 5.2 + vec2(-t * 0.9, t * 0.8) + 7.4);

  float waveDisp = (n1 * 0.07 + n2 * 0.04 + n3 * 0.02) * (0.65 + 0.65 * uEnergy);

  // Base ring radius is normalized to 1.0
  float baseR = 1.0 + breathe;

  // Multiple interwoven fine luminous filaments (the organic look)
  float ringDist1 = abs(r - (baseR + waveDisp));
  float ringDist2 = abs(r - (baseR + waveDisp * 0.78 + n2 * 0.035));
  float ringDist3 = abs(r - (baseR - waveDisp * 0.65 + n3 * 0.03));
  float ringDist4 = abs(r - (baseR + n1 * 0.05 - 0.02));
  float ringDist5 = abs(r - (baseR - n2 * 0.045 + 0.02));

  float f1 = smoothstep(0.040 + 0.015 * uEnergy, 0.0, ringDist1);
  float f2 = smoothstep(0.035 + 0.012 * uEnergy, 0.0, ringDist2);
  float f3 = smoothstep(0.035 + 0.012 * uEnergy, 0.0, ringDist3);
  float f4 = smoothstep(0.040 + 0.015 * uEnergy, 0.0, ringDist4);
  float f5 = smoothstep(0.032 + 0.012 * uEnergy, 0.0, ringDist5);

  float filaments = f1 * 1.0 + f2 * 0.80 + f3 * 0.75 + f4 * 0.70 + f5 * 0.60;

  // Diffuse atmospheric halo & aurora bloom around the ring
  float halo = exp(-abs(r - baseR - waveDisp * 0.5) * 6.5) * (0.35 + 0.25 * uEnergy);
  float outerGlow = exp(-max(0.0, r - baseR) * 2.8) * (0.12 + 0.10 * uEnergy);

  // Subtle ethereal inner core glow
  float innerCore = exp(-r * 2.2) * (0.08 + 0.16 * uEnergy);

  // 外側フェード: r が 2.0 に達するまでに完全に 0 に滑らかに収束させ、段差を完全に防止する
  float fadeOut = smoothstep(2.0, 1.1, r);

  // Total luminosity composite
  float totalLight = (filaments * 0.85 + halo + outerGlow + innerCore) * fadeOut;

  // Dynamic iridescent rim highlight that adapts naturally to the base state color
  vec3 baseCol = uColor;
  vec3 shiftColA = mix(uColor, vec3(1.0, 0.6, 0.9), 0.30);
  vec3 shiftColB = mix(uColor, vec3(0.4, 1.0, 0.9), 0.35);

  float huePhase = sin(angle * 2.0 + t * 0.8 + n1 * 2.0) * 0.5 + 0.5;
  vec3 colorGrad = mix(baseCol, mix(shiftColA, shiftColB, huePhase), 0.35);

  // Hot luminous core where filaments overlap (pure white center highlight)
  vec3 orbLight = colorGrad * totalLight + vec3(1.0) * pow(clamp(filaments * 0.65, 0.0, 1.0), 2.2) * 0.60;
  vec3 finalColor = uBgColor + orbLight;

  gl_FragColor = vec4(finalColor, 1.0);
}

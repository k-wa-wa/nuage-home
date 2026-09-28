precision highp float;
uniform vec2 uResolution;
uniform float uTime;
uniform float uEnergy;
uniform vec3 uColor;

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
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution.xy) / min(uResolution.x, uResolution.y);
  float r = length(uv);
  float angle = atan(uv.y, uv.x);

  // Time & dynamics: subtle living breathing base + responsive energy
  float t = uTime * (0.85 + 0.65 * uEnergy);
  float breathe = sin(uTime * 1.5) * 0.006 * (0.6 + 0.4 * uEnergy);

  // Seamless 360-degree polar noise sampling (guarantees zero seam/boundary artifact)
  vec2 circleCoord = vec2(cos(angle), sin(angle));

  // Multi-scale organic fluid displacement
  float n1 = fbm(circleCoord * 1.8 + vec2(t * 0.7, t * 0.5));
  float n2 = fbm(circleCoord * 3.4 - vec2(t * 0.6, -t * 0.7) + 3.1);
  float n3 = snoise(circleCoord * 5.2 + vec2(-t * 0.9, t * 0.8) + 7.4);

  float waveDisp = (n1 * 0.024 + n2 * 0.013 + n3 * 0.007) * (0.65 + 0.65 * uEnergy);

  // Base ring radius with gentle organic breathing
  float baseR = 0.300 + breathe;

  // Multiple interwoven fine luminous filaments (the organic look user praised)
  float ringDist1 = abs(r - (baseR + waveDisp));
  float ringDist2 = abs(r - (baseR + waveDisp * 0.78 + n2 * 0.011));
  float ringDist3 = abs(r - (baseR - waveDisp * 0.65 + n3 * 0.009));
  float ringDist4 = abs(r - (baseR + n1 * 0.016 - 0.007));
  float ringDist5 = abs(r - (baseR - n2 * 0.014 + 0.007));

  float f1 = smoothstep(0.012 + 0.005 * uEnergy, 0.0, ringDist1);
  float f2 = smoothstep(0.011 + 0.004 * uEnergy, 0.0, ringDist2);
  float f3 = smoothstep(0.011 + 0.004 * uEnergy, 0.0, ringDist3);
  float f4 = smoothstep(0.012 + 0.005 * uEnergy, 0.0, ringDist4);
  float f5 = smoothstep(0.010 + 0.004 * uEnergy, 0.0, ringDist5);

  float filaments = f1 * 1.0 + f2 * 0.80 + f3 * 0.75 + f4 * 0.70 + f5 * 0.60;

  // Diffuse atmospheric halo & aurora bloom around the ring
  float halo = exp(-abs(r - baseR - waveDisp * 0.5) * 20.0) * (0.35 + 0.25 * uEnergy);
  float outerGlow = exp(-abs(r - baseR) * 8.5) * (0.12 + 0.10 * uEnergy);

  // Subtle ethereal inner core glow
  float innerCore = exp(-r * 7.0) * (0.08 + 0.16 * uEnergy);

  // Total luminosity composite
  float totalLight = filaments * 0.85 + halo + outerGlow + innerCore;

  // Dynamic iridescent rim highlight that adapts naturally to the base state color
  vec3 baseCol = uColor;
  vec3 shiftColA = mix(uColor, vec3(1.0, 0.6, 0.9), 0.30); // Soft companion tint
  vec3 shiftColB = mix(uColor, vec3(0.4, 1.0, 0.9), 0.35); // Luminous companion highlight

  float huePhase = sin(angle * 2.0 + t * 0.8 + n1 * 2.0) * 0.5 + 0.5;
  vec3 colorGrad = mix(baseCol, mix(shiftColA, shiftColB, huePhase), 0.35);

  // Hot luminous core where filaments overlap (pure white center highlight)
  vec3 finalColor = colorGrad * totalLight + vec3(1.0) * pow(clamp(filaments * 0.65, 0.0, 1.0), 2.2) * 0.60;

  gl_FragColor = vec4(finalColor, 1.0);
}

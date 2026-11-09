import * as THREE from 'three';

export interface PostState {
  /** 0..1 — Mundiya proximity: barrel warp, aberration and wave wobble. */
  distortion: number;
  /** 0..1 — threat: grain and vignette breathing. */
  threat: number;
  /** 0..1 — fade to black for transitions. */
  fade: number;
  /** 0..1 — red/white hit flash when caught. */
  flash: number;
  time: number;
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform float uTime;
  uniform float uDistortion;
  uniform float uThreat;
  uniform float uFade;
  uniform float uFlash;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  void main() {
    vec2 center = vUv - 0.5;
    float r2 = dot(center, center);

    // Barrel warp + breathing wave while Mundiya is close.
    float warp = uDistortion * 0.16;
    vec2 uv = 0.5 + center * (1.0 + warp * r2 * 2.4);
    uv.x += sin(uv.y * 26.0 + uTime * 2.6) * 0.006 * uDistortion;
    uv.y += cos(uv.x * 21.0 - uTime * 2.1) * 0.005 * uDistortion;

    // Chromatic split grows with distortion and threat.
    float split = 0.0012 + uDistortion * 0.006 + uThreat * 0.0016;
    vec2 dir = normalize(center + 0.0001);
    float r = texture2D(tDiffuse, uv + dir * split).r;
    float g = texture2D(tDiffuse, uv).g;
    float b = texture2D(tDiffuse, uv - dir * split).b;
    vec3 color = vec3(r, g, b);

    // Cold, sickly grade with crushed blacks.
    color = pow(color, vec3(1.06, 1.0, 0.94));
    color = mix(color, color * vec3(0.82, 0.95, 1.05), 0.35);
    color += vec3(0.012, 0.018, 0.022);

    // Film grain.
    float grain = hash(vUv * vec2(1920.0, 1080.0) + fract(uTime) * 91.7);
    color += (grain - 0.5) * (0.055 + uThreat * 0.07 + uDistortion * 0.06);

    // Vignette squeezes in as the hunters close.
    float vignette = smoothstep(0.92, 0.18 - uThreat * 0.12, length(center) * (1.12 + uThreat * 0.4));
    color *= mix(0.35, 1.0, vignette);

    // Heartbeat pulse: a dark red wash that follows the beat.
    float pulse = smoothstep(0.55, 1.0, sin(uTime * (2.4 + uThreat * 3.4)) * 0.5 + 0.5) * uThreat;
    color = mix(color, vec3(0.22, 0.02, 0.02), pulse * 0.18);

    // Scanline grime.
    color *= 0.97 + 0.03 * sin(vUv.y * 900.0);

    // Hit flash and fades.
    color = mix(color, vec3(0.6, 0.03, 0.03), uFlash * 0.75);
    color *= 1.0 - uFade;

    // Linear -> sRGB (the scene was rendered into a linear target).
    color = pow(max(color, 0.0), vec3(1.0 / 2.2));
    gl_FragColor = vec4(color, 1.0);
  }
`;

/** Self-contained post stack: scene -> linear target -> fullscreen grade pass. */
export class HorrorPost {
  private renderer: THREE.WebGLRenderer;
  private target: THREE.WebGLRenderTarget;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  private quad: THREE.Mesh;

  constructor(renderer: THREE.WebGLRenderer, width: number, height: number) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 4,
    });
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uTime: { value: 0 },
        uDistortion: { value: 0 },
        uThreat: { value: 0 },
        uFade: { value: 0 },
        uFlash: { value: 0 },
      },
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    this.quad = new THREE.Mesh(geometry, this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  setSize(width: number, height: number): void {
    this.target.setSize(Math.max(2, width), Math.max(2, height));
  }

  render(scene: THREE.Scene, camera: THREE.Camera, state: PostState): void {
    const uniforms = this.material.uniforms;
    uniforms.uTime.value = state.time;
    uniforms.uDistortion.value = state.distortion;
    uniforms.uThreat.value = state.threat;
    uniforms.uFade.value = state.fade;
    uniforms.uFlash.value = state.flash;

    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    (this.quad.geometry as THREE.BufferGeometry).dispose();
  }
}

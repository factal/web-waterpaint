'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrthographicCamera } from '@react-three/drei'
import * as THREE from 'three'
import WatercolorSimulation, { type SimulationParams } from '@/lib/watercolor/WatercolorSimulation'
import { type DebugView } from './debugViews'

// Fullscreen quad shader that forwards UVs to the fragment stage.
const DISPLAY_VERTEX = `
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const DEBUG_VIEW_MODE: Record<DebugView, number> = {
  composite: 0,
  waterHeight: 1,
  velocity: 2,
  dissolvedPigment: 3,
  depositedPigment: 4,
  wetness: 5,
  binder: 6,
  granulation: 7,
  paperHeight: 8,
  paperSizing: 9,
  paperFibers: 10,
}

// Sample different simulation buffers based on the active debug view.
const DISPLAY_FRAGMENT = `
precision highp float;
in vec2 vUv;
uniform sampler2D uComposite;
uniform sampler2D uHeight;
uniform sampler2D uVelocity;
uniform sampler2D uPigment;
uniform sampler2D uDeposits;
uniform sampler2D uWetness;
uniform sampler2D uBinder;
uniform sampler2D uGranulation;
uniform sampler2D uPaperHeight;
uniform sampler2D uPaperSizing;
uniform sampler2D uPaperFiber;
uniform int uMode;
out vec4 fragColor;

const float PI = 3.141592653589793;

vec3 applyGamma(vec3 color) {
  return pow(clamp(color, vec3(0.0), vec3(1.0)), vec3(1.0 / 2.2));
}

vec3 hsv2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  rgb = rgb * rgb * (3.0 - 2.0 * rgb);
  return c.z * mix(vec3(1.0), rgb, c.y);
}

vec3 renderVelocity(vec2 vel) {
  float mag = length(vel);
  float intensity = 1.0 - exp(-mag * 4.0);
  float angle = atan(vel.y, vel.x);
  float hue = fract(angle / (2.0 * PI) + 0.5);
  return hsv2rgb(vec3(hue, 0.75, intensity));
}

vec3 renderScalar(float value) {
  float tone = 1.0 - exp(-max(value, 0.0));
  return vec3(tone);
}

void main() {
  vec3 color = vec3(0.0);

  if (uMode == 0) {
    color = applyGamma(texture(uComposite, vUv).rgb);
  } else if (uMode == 1) {
    float height = texture(uHeight, vUv).r;
    color = renderScalar(height * 8.0);
  } else if (uMode == 2) {
    vec2 vel = texture(uVelocity, vUv).rg;
    color = renderVelocity(vel);
  } else if (uMode == 3) {
    vec3 pigment = texture(uPigment, vUv).rgb;
    color = applyGamma(pigment * 2.0);
  } else if (uMode == 4) {
    vec3 deposits = texture(uDeposits, vUv).rgb;
    color = applyGamma(deposits * 1.5);
  } else if (uMode == 5) {
    float wet = texture(uWetness, vUv).r;
    color = renderScalar(wet * 5.0);
  } else if (uMode == 6) {
    float binder = texture(uBinder, vUv).r;
    float tone = 1.0 - exp(-max(binder, 0.0) * 4.0);
    color = vec3(tone, tone * 0.6, tone * 0.2);
  } else if (uMode == 7) {
    vec3 granulation = texture(uGranulation, vUv).rgb;
    color = applyGamma(granulation * 2.5);
  } else if (uMode == 8) {
    float paperHeight = texture(uPaperHeight, vUv).r;
    color = vec3(paperHeight);
  } else if (uMode == 9) {
    float sizing = texture(uPaperSizing, vUv).r;
    color = vec3(sizing);
  } else if (uMode == 10) {
    vec4 fiber = texture(uPaperFiber, vUv);
    vec2 dir = fiber.xy;
    float len = max(length(dir), 1e-4);
    dir /= len;
    float angle = atan(dir.y, dir.x);
    float hue = fract(angle / (2.0 * PI) + 0.5);
    float anisotropy = clamp((fiber.z - fiber.w) * 0.5 + 0.5, 0.0, 1.0);
    color = hsv2rgb(vec3(hue, 0.6, anisotropy));
  } else {
    color = applyGamma(texture(uComposite, vUv).rgb);
  }

  fragColor = vec4(color, 1.0);
}
`

type WatercolorSceneProps = {
  params: SimulationParams
  size?: number
  clearSignal: number
  onReady?: (sim: WatercolorSimulation | null) => void
  debugView?: DebugView
}

// WatercolorScene drives the GPU simulation and blits the result onto a fullscreen quad.
const WatercolorScene = ({
  params,
  size = 512,
  clearSignal,
  onReady,
  debugView = 'composite',
}: WatercolorSceneProps) => {
  const { gl } = useThree()
  const simRef = useRef<WatercolorSimulation | null>(null)
  const paramsRef = useRef(params)
  const accumulatorRef = useRef(0)
  // Lazily store uniforms so the shader can be updated without reconstructing it.
  const uniforms = useMemo(() => ({
    uComposite: { value: null as THREE.Texture | null },
    uHeight: { value: null as THREE.Texture | null },
    uVelocity: { value: null as THREE.Texture | null },
    uPigment: { value: null as THREE.Texture | null },
    uDeposits: { value: null as THREE.Texture | null },
    uWetness: { value: null as THREE.Texture | null },
    uBinder: { value: null as THREE.Texture | null },
    uGranulation: { value: null as THREE.Texture | null },
    uPaperHeight: { value: null as THREE.Texture | null },
    uPaperSizing: { value: null as THREE.Texture | null },
    uPaperFiber: { value: null as THREE.Texture | null },
    uMode: { value: 0 },
  }), [])

  // RawShaderMaterial lets us render the simulation output texture directly.
  const material = useMemo(
    () =>
      new THREE.RawShaderMaterial({
        uniforms,
        vertexShader: DISPLAY_VERTEX,
        fragmentShader: DISPLAY_FRAGMENT,
        glslVersion: THREE.GLSL3,
        depthTest: false,
        depthWrite: false,
        transparent: false,
      }),
    [uniforms],
  )

  useEffect(() => {
    paramsRef.current = params
  }, [params])

  // Create the simulation instance once the WebGL renderer is ready.
  const applyUniformTextures = useCallback(
    (sim: WatercolorSimulation) => {
      uniforms.uComposite.value = sim.outputTexture
      uniforms.uHeight.value = sim.waterHeightTexture
      uniforms.uVelocity.value = sim.velocityTexture
      uniforms.uPigment.value = sim.dissolvedPigmentTexture
      uniforms.uDeposits.value = sim.depositedPigmentTexture
      uniforms.uWetness.value = sim.wetnessTexture
      uniforms.uBinder.value = sim.binderTexture
      uniforms.uGranulation.value = sim.settledPigmentTexture
      uniforms.uPaperHeight.value = sim.paperHeightTexture
      uniforms.uPaperSizing.value = sim.paperSizingTexture
      uniforms.uPaperFiber.value = sim.paperFiberTexture
    },
    [uniforms],
  )

  useEffect(() => {
    const sim = new WatercolorSimulation(gl, size)
    simRef.current = sim
    applyUniformTextures(sim)
    onReady?.(sim)

    return () => {
      onReady?.(null)
      uniforms.uComposite.value = null
      uniforms.uHeight.value = null
      uniforms.uVelocity.value = null
      uniforms.uPigment.value = null
      uniforms.uDeposits.value = null
      uniforms.uWetness.value = null
      uniforms.uBinder.value = null
      uniforms.uGranulation.value = null
      uniforms.uPaperHeight.value = null
      uniforms.uPaperSizing.value = null
      uniforms.uPaperFiber.value = null
      sim.dispose()
      simRef.current = null
    }
  }, [gl, size, onReady, applyUniformTextures, uniforms])

  useEffect(() => () => material.dispose(), [material])

  // Incoming clearSignal increments trigger a full state reset.
  useEffect(() => {
    if (clearSignal === 0) return
    simRef.current?.reset()
  }, [clearSignal])

  useEffect(() => {
    uniforms.uMode.value = DEBUG_VIEW_MODE[debugView] ?? 0
  }, [debugView, uniforms])

  // Advance the simulation with a fixed timestep for numerical stability.
  useFrame((_, delta) => {
    const sim = simRef.current
    if (!sim) return

    accumulatorRef.current += delta
    const fixedDt = 1 / 90
    while (accumulatorRef.current >= fixedDt) {
      sim.step(paramsRef.current, fixedDt)
      accumulatorRef.current -= fixedDt
    }

    applyUniformTextures(sim)
  })

  return (
    <>
      <mesh>
        <planeGeometry args={[2, 2]} />
        <primitive object={material} attach='material' />
      </mesh>
      {/* Orthographic camera keeps the quad aligned with screen space. */}
      <OrthographicCamera makeDefault position={[0, 0, 1]} near={0} far={10} />
    </>
  )
}

export default WatercolorScene


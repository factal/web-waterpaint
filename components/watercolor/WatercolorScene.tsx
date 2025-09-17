'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrthographicCamera } from '@react-three/drei'
import * as THREE from 'three'
import WatercolorSimulation, { type SimulationParams } from '@/lib/watercolor/WatercolorSimulation'

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

// Sample the simulation texture and present a gamma-corrected color.
const DISPLAY_FRAGMENT = `
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 fragColor;
void main() {
  vec3 col = texture(uTexture, vUv).rgb;
  vec3 gamma = pow(clamp(col, vec3(0.0), vec3(1.0)), vec3(1.0/2.2));
  fragColor = vec4(gamma, 1.0);
}
`

type WatercolorSceneProps = {
  params: SimulationParams
  size?: number
  clearSignal: number
  onReady?: (sim: WatercolorSimulation | null) => void
}

// WatercolorScene drives the GPU simulation and blits the result onto a fullscreen quad.
const WatercolorScene = ({ params, size = 512, clearSignal, onReady }: WatercolorSceneProps) => {
  const { gl } = useThree()
  const simRef = useRef<WatercolorSimulation | null>(null)
  const paramsRef = useRef(params)
  const accumulatorRef = useRef(0)
  // Lazily store uniforms so the shader can be updated without reconstructing it.
  const uniforms = useMemo(() => ({
    uTexture: { value: null as THREE.Texture | null },
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
  useEffect(() => {
    const sim = new WatercolorSimulation(gl, size)
    simRef.current = sim
    uniforms.uTexture.value = sim.outputTexture
    onReady?.(sim)

    return () => {
      onReady?.(null)
      uniforms.uTexture.value = null
      sim.dispose()
      simRef.current = null
    }
  }, [gl, size, onReady, uniforms])

  useEffect(() => () => material.dispose(), [material])

  // Incoming clearSignal increments trigger a full state reset.
  useEffect(() => {
    if (clearSignal === 0) return
    simRef.current?.reset()
  }, [clearSignal])

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


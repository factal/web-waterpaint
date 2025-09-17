import { Canvas } from '@react-three/fiber'
import { Preload } from '@react-three/drei'
import r3f from '../helpers/r3f'
import * as THREE from 'three'

// Scene hosts the single three-fiber canvas and exposes it via the tunnel.
export default function Scene({ ...props }) {
  // Everything defined in here will persist between route changes, only children are swapped
  return (
    <Canvas {...props}
      onCreated={(state) => (state.gl.toneMapping = THREE.AgXToneMapping)}
    >
      <r3f.Out />
      <Preload all />
    </Canvas>
  )
}

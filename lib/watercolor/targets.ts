import * as THREE from 'three'

import { type PingPongTarget } from './types'

export function createRenderTarget(size: number, type: THREE.TextureDataType) {
  const target = new THREE.WebGLRenderTarget(size, size, {
    type,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
  })
  target.texture.generateMipmaps = false
  target.texture.wrapS = THREE.ClampToEdgeWrapping
  target.texture.wrapT = THREE.ClampToEdgeWrapping
  target.texture.colorSpace = THREE.NoColorSpace
  return target
}

export function createPingPong(size: number, type: THREE.TextureDataType): PingPongTarget {
  const a = createRenderTarget(size, type)
  const b = createRenderTarget(size, type)
  return {
    read: a,
    write: b,
    swap() {
      const temp = this.read
      this.read = this.write
      this.write = temp
    },
  }
}

export function createFiberField(size: number): THREE.DataTexture {
  const data = new Float32Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4
      const u = x / size
      const v = y / size
      const nx = u - 0.5
      const ny = v - 0.5
      const swirl = Math.sin((nx + ny) * Math.PI * 4.0)
      const wave = Math.cos((nx * 6.0) - (ny * 5.0))
      const angle = Math.atan2(ny, nx + 1e-6) * 0.35 + swirl * 0.6
      const dirX = Math.cos(angle)
      const dirY = Math.sin(angle)
      const dPara = 0.7 + 0.25 * wave
      const dPerp = 0.18 + 0.12 * Math.sin((nx - ny) * Math.PI * 6.0)
      data[idx + 0] = dirX
      data[idx + 1] = dirY
      data[idx + 2] = Math.max(0.2, dPara)
      data[idx + 3] = Math.max(0.05, dPerp)
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType)
  texture.needsUpdate = true
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.colorSpace = THREE.NoColorSpace
  return texture
}

function pseudoRandom(x: number, y: number): number {
  const dot = x * 127.1 + y * 311.7
  const sin = Math.sin(dot) * 43758.5453
  return sin - Math.floor(sin)
}

export function createPaperHeight(size: number): THREE.DataTexture {
  const data = new Float32Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4
      const u = x / size
      const v = y / size
      const ridge = 0.45 + 0.3 * Math.sin((u + v) * Math.PI * 2.5)
      const swirl = 0.2 * Math.sin((u * 12.0) - (v * 9.0))
      const grain = 0.35 * pseudoRandom(x * 3.1, y * 2.7)
      const height = Math.min(1, Math.max(0, ridge + swirl + grain - 0.1))
      data[idx + 0] = height
      data[idx + 1] = height
      data[idx + 2] = height
      data[idx + 3] = 1
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType)
  texture.needsUpdate = true
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.colorSpace = THREE.NoColorSpace
  return texture
}

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

export function createPaperHeightField(size: number): THREE.DataTexture {
  const data = new Float32Array(size * size * 4)

  const pseudoRandom = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123
    return n - Math.floor(n)
  }

  const fade = (t: number) => t * t * (3 - 2 * t)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t

  const valueNoise = (x: number, y: number) => {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const fx = x - ix
    const fy = y - iy

    const v00 = pseudoRandom(ix, iy)
    const v10 = pseudoRandom(ix + 1, iy)
    const v01 = pseudoRandom(ix, iy + 1)
    const v11 = pseudoRandom(ix + 1, iy + 1)

    const u = fade(fx)
    const v = fade(fy)

    const x0 = lerp(v00, v10, u)
    const x1 = lerp(v01, v11, u)
    return lerp(x0, x1, v)
  }

  const octaves = 4
  const lacunarity = 2.07
  const persistence = 0.55
  const scale = 3.5

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4
      const u = x / size
      const v = y / size

      let amplitude = 1
      let frequency = 1
      let total = 0
      let sum = 0

      for (let octave = 0; octave < octaves; octave += 1) {
        const nx = (u + 13.27) * frequency * scale
        const ny = (v + 7.91) * frequency * scale
        sum += valueNoise(nx, ny) * amplitude
        total += amplitude
        amplitude *= persistence
        frequency *= lacunarity
      }

      let height = total > 0 ? sum / total : 0
      height = Math.pow(height, 1.6)
      height = THREE.MathUtils.clamp(height, 0, 1)

      data[idx + 0] = height
      data[idx + 1] = height
      data[idx + 2] = height
      data[idx + 3] = 1.0
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType)
  texture.needsUpdate = true
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.colorSpace = THREE.NoColorSpace
  texture.name = 'PaperHeightField'
  return texture
}

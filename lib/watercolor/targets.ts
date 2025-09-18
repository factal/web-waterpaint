import * as THREE from 'three'

import { type PingPongTarget } from './types'

export type PaperFieldTextures = {
  fiber: THREE.DataTexture
  height: THREE.DataTexture
}

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

export function createPaperField(size: number): PaperFieldTextures {
  const fiberData = new Float32Array(size * size * 4)
  const heightData = new Float32Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4
      const u = x / size
      const v = y / size
      const nx = u - 0.5
      const ny = v - 0.5
      const swirl = Math.sin((nx + ny) * Math.PI * 4.0)
      const wave = Math.cos(nx * 6.0 - ny * 5.0)
      const angle = Math.atan2(ny, nx + 1e-6) * 0.35 + swirl * 0.6
      const dirX = Math.cos(angle)
      const dirY = Math.sin(angle)
      const dPara = 0.7 + 0.25 * wave
      const dPerp = 0.18 + 0.12 * Math.sin((nx - ny) * Math.PI * 6.0)
      fiberData[idx + 0] = dirX
      fiberData[idx + 1] = dirY
      fiberData[idx + 2] = Math.max(0.2, dPara)
      fiberData[idx + 3] = Math.max(0.05, dPerp)

      const radial = Math.sin((nx * nx + ny * ny) * 40.0)
      const crossgrain = Math.sin((nx + ny) * Math.PI * 10.0) * Math.sin((nx - ny) * Math.PI * 7.0)
      const baseHeight = 0.5 + 0.35 * swirl + 0.25 * wave
      const detail = 0.12 * radial + 0.08 * crossgrain
      const height = Math.min(Math.max(baseHeight + detail, 0.0), 1.0)
      heightData[idx + 0] = height
      heightData[idx + 1] = height
      heightData[idx + 2] = height
      heightData[idx + 3] = 1.0
    }
  }
  const fiberTexture = new THREE.DataTexture(fiberData, size, size, THREE.RGBAFormat, THREE.FloatType)
  fiberTexture.needsUpdate = true
  fiberTexture.wrapS = THREE.RepeatWrapping
  fiberTexture.wrapT = THREE.RepeatWrapping
  fiberTexture.magFilter = THREE.LinearFilter
  fiberTexture.minFilter = THREE.LinearFilter
  fiberTexture.colorSpace = THREE.NoColorSpace

  const heightTexture = new THREE.DataTexture(heightData, size, size, THREE.RGBAFormat, THREE.FloatType)
  heightTexture.needsUpdate = true
  heightTexture.wrapS = THREE.RepeatWrapping
  heightTexture.wrapT = THREE.RepeatWrapping
  heightTexture.magFilter = THREE.LinearFilter
  heightTexture.minFilter = THREE.LinearFilter
  heightTexture.colorSpace = THREE.NoColorSpace

  return { fiber: fiberTexture, height: heightTexture }
}

export function createFiberField(size: number): THREE.DataTexture {
  return createPaperField(size).fiber
}

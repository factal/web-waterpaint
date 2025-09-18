import * as THREE from 'three'

function configureTexture(texture: THREE.Texture) {
  texture.generateMipmaps = false
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.colorSpace = THREE.NoColorSpace
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
  configureTexture(target.texture)
  return target
}

export interface PingPongTarget<T extends THREE.WebGLRenderTarget> {
  read: T
  write: T
  swap: () => void
}

export function createPingPong(size: number, type: THREE.TextureDataType): PingPongTarget<THREE.WebGLRenderTarget> {
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

export function createMultipleRenderTarget(
  size: number,
  type: THREE.TextureDataType,
  count: number,
): THREE.WebGLMultipleRenderTargets {
  const target = new THREE.WebGLMultipleRenderTargets(size, size, count, {
    type,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
  })
  for (let i = 0; i < count; i += 1) {
    configureTexture(target.texture[i])
  }
  return target
}

export function createLBMPingPong(size: number, type: THREE.TextureDataType): PingPongTarget<THREE.WebGLMultipleRenderTargets> {
  const a = createMultipleRenderTarget(size, type, 3)
  const b = createMultipleRenderTarget(size, type, 3)
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

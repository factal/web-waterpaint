import * as THREE from 'three'

import { createPingPong } from './targets'
import { type PingPongTarget } from './types'

export type MaskStamp = {
  center: [number, number]
  radius: number
  rotation: number
  scale: [number, number]
  strength: number
}

export type MaskBuildResult = {
  texture: THREE.Texture
  target: THREE.WebGLRenderTarget
}

export class StrokeMaskBuilder {
  private readonly renderer: THREE.WebGLRenderer
  private readonly material: THREE.RawShaderMaterial
  private readonly zeroMaterial: THREE.RawShaderMaterial
  private readonly targets: PingPongTarget
  private readonly scene: THREE.Scene
  private readonly camera: THREE.OrthographicCamera
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.RawShaderMaterial>

  constructor(
    renderer: THREE.WebGLRenderer,
    material: THREE.RawShaderMaterial,
    zeroMaterial: THREE.RawShaderMaterial,
    size: number,
    textureType: THREE.TextureDataType,
  ) {
    this.renderer = renderer
    this.material = material
    this.zeroMaterial = zeroMaterial
    this.targets = createPingPong(size, textureType)
    this.scene = new THREE.Scene()
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    this.scene.add(this.quad)
  }

  dispose() {
    this.quad.geometry.dispose()
    this.targets.read.dispose()
    this.targets.write.dispose()
  }

  build(stamps: MaskStamp[], brushMask: THREE.Texture): MaskBuildResult {
    const previousTarget = this.renderer.getRenderTarget()
    const previousAutoClear = this.renderer.autoClear

    this.renderer.autoClear = false
    this.clearTargets()

    this.material.uniforms.uBristleMask.value = brushMask

    if (stamps.length === 0) {
      this.renderer.setRenderTarget(previousTarget)
      this.renderer.autoClear = previousAutoClear
      return { texture: this.targets.read.texture, target: this.targets.read }
    }

    for (const stamp of stamps) {
      this.material.uniforms.uSource.value = this.targets.read.texture
      this.material.uniforms.uCenter.value.set(stamp.center[0], stamp.center[1])
      this.material.uniforms.uRadius.value = Math.max(stamp.radius, 1e-6)
      this.material.uniforms.uMaskScale.value.set(stamp.scale[0], stamp.scale[1])
      this.material.uniforms.uMaskRotation.value = stamp.rotation
      this.material.uniforms.uMaskStrength.value = stamp.strength

      this.renderMaterial(this.material, this.targets.write)
      this.targets.swap()
    }

    this.renderer.setRenderTarget(previousTarget)
    this.renderer.autoClear = previousAutoClear

    return { texture: this.targets.read.texture, target: this.targets.read }
  }

  private clearTargets() {
    this.renderMaterial(this.zeroMaterial, this.targets.read)
    this.renderMaterial(this.zeroMaterial, this.targets.write)
    // Ensure read buffer holds cleared state after swaps
    this.targets.swap()
    this.renderMaterial(this.zeroMaterial, this.targets.write)
    this.targets.swap()
  }

  private renderMaterial(
    material: THREE.RawShaderMaterial,
    target: THREE.WebGLRenderTarget,
  ) {
    this.quad.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
  }
}

export default StrokeMaskBuilder

import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
} from 'three'
import { WeaponKind } from '../../shared/unit-types.ts'
import { PITCH, cameraYaw } from './stage.ts'
import { TILE_TOP } from './terrain.ts'

const EXPLOSION = {
  count: 24,
  speed: 3.4,
  life: 0.65,
  gravity: 7,
  color: 0xff7a24,
  size: 0.16,
  star: 1.15,
  starLife: 0.42,
  starColor: 0xfff0c8,
}

const SHELL_HIT = {
  count: 14,
  speed: 2.4,
  life: 0.38,
  gravity: 8,
  color: 0xffb15a,
  size: 0.1,
  star: 0.55,
  starLife: 0.28,
  starColor: 0xffe2a8,
}

const ROCKET_HIT = {
  count: 22,
  speed: 3.2,
  life: 0.55,
  gravity: 7,
  color: 0xff5a18,
  size: 0.16,
  star: 1.05,
  starLife: 0.4,
  starColor: 0xfff0c0,
}

const BULLET_HIT = {
  count: 7,
  speed: 1.6,
  life: 0.18,
  gravity: 4,
  color: 0xffe7a3,
  size: 0.06,
  star: 0.22,
  starLife: 0.14,
  starColor: 0xfff6d4,
}

const LEAF_COLORS = [0x8fce5a, 0x4f8f38, 0xd7b56a, 0x2f6a28]

type Style = typeof EXPLOSION

type Effect = {
  advance(dt: number): boolean
  dispose(): void
}

type Spark = {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

export class Particles {
  private readonly bursts: Effect[] = []

  constructor(private readonly scene: Scene) {}

  explosion(x: number, y: number, z: number) {
    this.bursts.push(new Burst(this.scene, x, y, z, EXPLOSION))
  }

  hit(x: number, z: number, kind: WeaponKind) {
    const style = kind === WeaponKind.Rocket ? ROCKET_HIT : kind === WeaponKind.Shell ? SHELL_HIT : BULLET_HIT
    this.bursts.push(new Burst(this.scene, x, TILE_TOP + 0.22, z, style))
  }

  fell(x: number, z: number) {
    this.bursts.push(new LeafBurst(this.scene, x, z))
  }

  collect(x: number, z: number) {
    this.bursts.push(new CoinBurst(this.scene, x, z))
  }

  advance(dt: number) {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      if (this.bursts[i].advance(dt)) continue
      this.bursts[i].dispose()
      this.bursts.splice(i, 1)
    }
  }
}

class Burst {
  private readonly sparks: Spark[]
  private readonly bits: Group
  private readonly bitMaterial: MeshBasicMaterial
  private readonly star: Group
  private readonly starMaterial: MeshBasicMaterial
  private age = 0

  constructor(
    scene: Scene,
    x: number,
    y: number,
    z: number,
    private readonly style: Style,
  ) {
    this.sparks = []
    this.bitMaterial = new MeshBasicMaterial({
      color: style.color,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    })
    const geometry = new PlaneGeometry(style.size, style.size)
    this.bits = new Group()
    this.bits.position.set(x, y, z)
    for (let i = 0; i < style.count; i++) {
      const yaw = Math.random() * Math.PI * 2
      const lift = 0.25 + Math.random() * 1.05
      const speed = style.speed * (0.45 + Math.random() * 0.7)
      const horizontal = Math.cos(lift)
      this.sparks.push({
        x: 0,
        y: 0,
        z: 0,
        vx: Math.cos(yaw) * horizontal * speed,
        vy: Math.sin(lift) * speed,
        vz: Math.sin(yaw) * horizontal * speed,
      })
      const bit = new Mesh(geometry, this.bitMaterial)
      bit.rotation.order = 'YXZ'
      bit.rotation.x = -PITCH
      bit.frustumCulled = false
      this.bits.add(bit)
    }
    const star = makeStarburst(style.star, style.starColor)
    this.star = star.group
    this.starMaterial = star.material
    this.star.position.set(x, y, z)
    scene.add(this.bits, this.star)
  }

  advance(dt: number): boolean {
    this.age += dt
    this.bitMaterial.opacity = Math.max(1 - this.age / this.style.life, 0)
    for (let i = 0; i < this.sparks.length; i++) {
      const spark = this.sparks[i]
      const bit = this.bits.children[i]
      spark.vy -= this.style.gravity * dt
      spark.x += spark.vx * dt
      spark.y += spark.vy * dt
      spark.z += spark.vz * dt
      bit.position.set(spark.x, spark.y, spark.z)
      bit.rotation.set(-PITCH, cameraYaw, 0)
    }
    const starT = Math.min(1, this.age / this.style.starLife)
    this.star.rotation.set(-PITCH, cameraYaw, 0)
    this.star.scale.setScalar(0.35 + starT * 1.7)
    this.starMaterial.opacity = (1 - starT) * (1 - starT)
    this.star.visible = starT < 1
    return this.age < this.style.life
  }

  dispose() {
    this.bits.removeFromParent()
    this.star.removeFromParent()
    const geometries = new Set<BufferGeometry>()
    this.bits.traverse((obj) => {
      if (obj instanceof Mesh) geometries.add(obj.geometry)
    })
    this.star.traverse((obj) => {
      if (obj instanceof Mesh) geometries.add(obj.geometry)
    })
    for (const geometry of geometries) geometry.dispose()
    this.bitMaterial.dispose()
    this.starMaterial.dispose()
  }
}

class LeafBurst implements Effect {
  private readonly leaves: { mesh: Mesh; vx: number; vy: number; vz: number; spin: number; phase: number }[]
  private readonly materials: MeshBasicMaterial[]
  private readonly geometry: PlaneGeometry
  private readonly ring: Mesh
  private readonly ringMaterial: MeshBasicMaterial
  private age = 0

  constructor(scene: Scene, x: number, z: number) {
    this.materials = LEAF_COLORS.map(
      (color) =>
        new MeshBasicMaterial({
          color,
          transparent: true,
          depthWrite: false,
          side: DoubleSide,
        }),
    )
    this.leaves = []
    const geometry = new PlaneGeometry(0.16, 0.09)
    this.geometry = geometry
    for (let i = 0; i < 16; i++) {
      const yaw = Math.random() * Math.PI * 2
      const speed = 1.1 + Math.random() * 1.6
      const mesh = new Mesh(geometry, this.materials[i % this.materials.length])
      mesh.position.set(x, TILE_TOP + 0.55, z)
      mesh.frustumCulled = false
      scene.add(mesh)
      this.leaves.push({
        mesh,
        vx: Math.cos(yaw) * speed,
        vy: 1.2 + Math.random() * 1.4,
        vz: Math.sin(yaw) * speed,
        spin: (Math.random() - 0.5) * 10,
        phase: Math.random() * Math.PI * 2,
      })
    }
    this.ringMaterial = new MeshBasicMaterial({
      color: 0xb7d98a,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    })
    this.ring = new Mesh(new CircleGeometry(0.35, 12), this.ringMaterial)
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.set(x, TILE_TOP + 0.12, z)
    this.ring.frustumCulled = false
    scene.add(this.ring)
  }

  advance(dt: number): boolean {
    this.age += dt
    const life = 1.05
    const fade = Math.max(1 - this.age / life, 0)
    for (const material of this.materials) material.opacity = fade
    for (const leaf of this.leaves) {
      leaf.vy -= 2.4 * dt
      leaf.mesh.position.x += leaf.vx * dt
      leaf.mesh.position.y += leaf.vy * dt
      leaf.mesh.position.z += leaf.vz * dt
      const flutter = Math.sin(this.age * 11 + leaf.phase) * 0.35
      leaf.mesh.position.x += flutter * dt
      leaf.mesh.rotation.set(-PITCH, cameraYaw, this.age * leaf.spin)
      if (leaf.mesh.position.y < TILE_TOP + 0.08) {
        leaf.mesh.position.y = TILE_TOP + 0.08
        leaf.vy = Math.abs(leaf.vy) * 0.25
        leaf.vx *= 0.7
        leaf.vz *= 0.7
      }
    }
    const puff = Math.min(1, this.age / 0.45)
    this.ring.scale.setScalar(1 + puff * 2.4)
    this.ringMaterial.opacity = (1 - puff) * 0.7
    this.ring.visible = puff < 1
    return this.age < life
  }

  dispose() {
    for (const leaf of this.leaves) leaf.mesh.removeFromParent()
    this.geometry.dispose()
    this.ring.removeFromParent()
    this.ring.geometry.dispose()
    for (const material of this.materials) material.dispose()
    this.ringMaterial.dispose()
  }
}

class CoinBurst implements Effect {
  private readonly motes: { mesh: Mesh; vx: number; vy: number; vz: number }[]
  private readonly material: MeshBasicMaterial
  private readonly geometry: PlaneGeometry
  private age = 0

  constructor(scene: Scene, x: number, z: number) {
    this.material = new MeshBasicMaterial({
      color: 0xf0c84a,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    })
    this.geometry = new PlaneGeometry(0.07, 0.07)
    this.motes = []
    for (let i = 0; i < 6; i++) {
      const yaw = (i / 6) * Math.PI * 2
      const mesh = new Mesh(this.geometry, this.material)
      mesh.position.set(x + Math.cos(yaw) * 0.18, TILE_TOP + 1.7, z + Math.sin(yaw) * 0.18)
      mesh.frustumCulled = false
      scene.add(mesh)
      this.motes.push({ mesh, vx: Math.cos(yaw) * 0.35, vy: 0.9 + (i % 3) * 0.15, vz: Math.sin(yaw) * 0.35 })
    }
  }

  advance(dt: number): boolean {
    this.age += dt
    const life = 0.7
    this.material.opacity = Math.max(1 - this.age / life, 0)
    for (const mote of this.motes) {
      mote.mesh.position.x += mote.vx * dt
      mote.mesh.position.y += mote.vy * dt
      mote.mesh.position.z += mote.vz * dt
      mote.mesh.rotation.set(-PITCH, cameraYaw, 0)
    }
    return this.age < life
  }

  dispose() {
    for (const mote of this.motes) mote.mesh.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
  }
}

function makeStarburst(scale: number, color: number): { group: Group; material: MeshBasicMaterial } {
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  })
  const group = new Group()
  group.rotation.order = 'YXZ'
  group.rotation.x = -PITCH
  group.frustumCulled = false
  group.add(new Mesh(new CircleGeometry(0.22 * scale, 10), material))
  const ray = new PlaneGeometry(0.045 * scale, 0.7 * scale)
  for (let i = 0; i < 8; i++) {
    const mesh = new Mesh(ray, material)
    mesh.rotation.z = (i / 8) * Math.PI
    group.add(mesh)
  }
  return { group, material }
}

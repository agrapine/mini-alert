import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Scene,
} from 'three'
import type { ShotEvent } from '../../shared/protocol.ts'
import { WeaponKind } from '../../shared/unit-types.ts'
import { TILE_TOP } from './terrain.ts'

const TRACER_LIFE = 0.12
const SHOT_Y = TILE_TOP + 0.45

type LiveShot = {
  kind: WeaponKind
  object: Line | Mesh
  age: number
  flight: number
  originX: number
  originZ: number
  aimX: number
  aimZ: number
}

export class ShotLayer {
  private readonly live: LiveShot[] = []

  constructor(private readonly scene: Scene) {}

  spawn(events: readonly ShotEvent[], onImpact?: (x: number, z: number, kind: WeaponKind) => void) {
    for (const event of events) {
      const object = event.kind === WeaponKind.Bullet ? tracer() : shell()
      this.scene.add(object)
      const shot: LiveShot = {
        kind: event.kind,
        object,
        age: 0,
        flight: event.flight,
        originX: event.x,
        originZ: event.z,
        aimX: event.aimX,
        aimZ: event.aimZ,
      }
      place(shot)
      this.live.push(shot)
      if (event.kind === WeaponKind.Bullet) onImpact?.(event.aimX, event.aimZ, event.kind)
    }
  }

  advance(dt: number, onImpact?: (x: number, z: number, kind: WeaponKind) => void) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const shot = this.live[i]
      shot.age += dt
      const done = shot.kind === WeaponKind.Bullet ? shot.age >= TRACER_LIFE : shot.age >= shot.flight
      if (done) {
        if (shot.kind === WeaponKind.Shell) onImpact?.(shot.aimX, shot.aimZ, shot.kind)
        this.scene.remove(shot.object)
        this.live.splice(i, 1)
        continue
      }
      place(shot)
    }
  }
}

function tracer(): Line {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3))
  return new Line(geometry, new LineBasicMaterial({ color: 0xffe7a3 }))
}

function shell(): Mesh {
  return new Mesh(new BoxGeometry(0.12, 0.12, 0.22), new MeshBasicMaterial({ color: 0xf0d060 }))
}

function place(shot: LiveShot) {
  if (shot.object instanceof Line) {
    const position = shot.object.geometry.getAttribute('position')
    position.setXYZ(0, shot.originX, SHOT_Y, shot.originZ)
    position.setXYZ(1, shot.aimX, SHOT_Y, shot.aimZ)
    position.needsUpdate = true
    return
  }
  const t = shot.flight <= 0 ? 1 : Math.min(1, shot.age / shot.flight)
  shot.object.position.set(
    shot.originX + (shot.aimX - shot.originX) * t,
    SHOT_Y,
    shot.originZ + (shot.aimZ - shot.originZ) * t,
  )
  shot.object.rotation.y = Math.atan2(shot.aimX - shot.originX, shot.aimZ - shot.originZ)
}

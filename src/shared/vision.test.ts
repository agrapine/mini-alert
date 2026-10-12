import { describe, expect, it } from 'vitest'
import type { ShotEvent, UnitSnapshot } from './protocol.ts'
import { UnitTypeId, WeaponKind } from './unit-types.ts'
import { CITY_SIGHT } from './cities.ts'
import { FOG_FEATHER, FOG_TEXELS, growExplored, shotsForPlayer, stampExploredDistance, stampSight, unitsForPlayer } from './vision.ts'

function snapshot(id: number, ownerId: number, x: number, z: number, typeId = UnitTypeId.Scout): UnitSnapshot {
  return {
    id,
    typeId,
    ownerId,
    color: 0xffffff,
    x,
    z,
    facing: 0,
    turretYaw: 0,
    health: 40,
    tileX: Math.floor(x),
    tileY: Math.floor(z),
    speed: 0,
    path: [],
    goal: null,
    attackId: null,
    attackPoint: null,
    progress: 1,
  }
}

describe('vision', () => {
  it('sends a unit inside sight and omits one just outside', () => {
    const own = snapshot(1, 1, 0, 0)
    const inside = snapshot(2, 2, 12, 0)
    const outside = snapshot(3, 2, 12.1, 0)
    const seen = unitsForPlayer([own, inside, outside], 1)
    expect(seen.map((unit) => unit.id)).toEqual([1, 2])
  })

  it('includes a player unit that is alone', () => {
    const own = snapshot(1, 1, 4, 4, UnitTypeId.HeavyTank)
    expect(unitsForPlayer([own], 1).map((unit) => unit.id)).toEqual([1])
  })

  it('keeps a shot that starts or lands in sight', () => {
    const own = snapshot(1, 1, 0, 0)
    const hidden: ShotEvent = {
      kind: WeaponKind.Shell,
      shooterId: 9,
      x: 40,
      z: 40,
      aimX: 40,
      aimZ: 40,
      flight: 1,
    }
    const landing: ShotEvent = { ...hidden, aimX: 4, aimZ: 0 }
    expect(shotsForPlayer([hidden, landing], [own], 1)).toEqual([landing])
  })

  it('reveals ground and enemies within range of an owned city', () => {
    const inside = snapshot(2, 2, CITY_SIGHT, 0)
    const outside = snapshot(3, 2, CITY_SIGHT + 0.1, 0)
    const owned = [{ ownerId: 1, x: 0, z: 0 }]
    expect(unitsForPlayer([inside, outside], 1, owned).map((unit) => unit.id)).toEqual([2])
    expect(unitsForPlayer([inside], 1, [{ ownerId: 0, x: 0, z: 0 }])).toEqual([])
    expect(unitsForPlayer([inside], 1, [{ ownerId: 2, x: 0, z: 0 }])).toEqual([])
    const landing: ShotEvent = {
      kind: WeaponKind.Shell,
      shooterId: 9,
      x: 40,
      z: 40,
      aimX: 4,
      aimZ: 0,
      flight: 1,
    }
    expect(shotsForPlayer([landing], [], 1, owned)).toEqual([landing])
  })

  it('keeps a tile explored after the unit that saw it moves away', () => {
    const width = 40
    const height = 40
    const explored = new Uint8Array(width * height)
    const visible = new Uint8Array(width * height)
    stampSight(width, height, [{ x: 5.5, z: 5.5, sight: 2 }], explored, visible)
    const tile = 5 * width + 5
    expect(visible[tile]).toBe(1)
    expect(explored[tile]).toBe(1)
    stampSight(width, height, [{ x: 30.5, z: 30.5, sight: 2 }], explored, visible)
    expect(visible[tile]).toBe(0)
    expect(explored[tile]).toBe(1)
  })

  it('explores terrain two tiles past sight without revealing it', () => {
    const width = 30
    const height = 30
    const explored = new Uint8Array(width * height)
    const visible = new Uint8Array(width * height)
    stampSight(width, height, [{ x: 10.5, z: 10.5, sight: 2 }], explored, visible)
    const near = 10 * width + 13
    const far = 10 * width + 15
    expect(visible[near]).toBe(0)
    expect(explored[near]).toBe(0)
    growExplored(explored, width, height)
    expect(explored[near]).toBe(1)
    expect(visible[near]).toBe(0)
    expect(explored[far]).toBe(0)
  })

  it('keeps a smooth explored distance and ignores points past the feather', () => {
    const width = 20
    const height = 20
    const cols = width * FOG_TEXELS
    const field = new Float32Array(cols * height * FOG_TEXELS).fill(FOG_FEATHER)
    stampExploredDistance(FOG_TEXELS, width, height, [{ x: 5, z: 5, sight: 3 }], field)
    const center = texelIndex(cols, 5, 5)
    expect(field[center]).toBeLessThan(0)
    const far = texelIndex(cols, 5 + 3 + FOG_FEATHER + 1, 5)
    expect(field[far]).toBeCloseTo(FOG_FEATHER)
    const remembered = field[center]
    stampExploredDistance(FOG_TEXELS, width, height, [{ x: 15, z: 15, sight: 2 }], field)
    expect(field[center]).toBe(remembered)
    expect(field[texelIndex(cols, 15, 15)]).toBeLessThan(0)
  })
})

function texelIndex(cols: number, x: number, z: number): number {
  const tx = Math.min(cols - 1, Math.max(0, Math.floor(x * FOG_TEXELS)))
  const ty = Math.min(cols - 1, Math.max(0, Math.floor(z * FOG_TEXELS)))
  return ty * cols + tx
}

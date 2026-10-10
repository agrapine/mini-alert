import { describe, expect, it } from 'vitest'
import type { ShotEvent, UnitSnapshot } from './protocol.ts'
import { UnitTypeId, WeaponKind } from './unit-types.ts'
import { shotsForPlayer, stampSight, unitsForPlayer } from './vision.ts'

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
    goal: null,
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
})

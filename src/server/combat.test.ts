import { describe, expect, it } from 'vitest'
import { WeaponKind, UnitTypeId } from '../shared/unit-types.ts'
import { Game } from './game.ts'
import { World } from './world.ts'

function battle() {
  const game = new Game(new World(24, 24))
  const human = game.addPlayer()
  const enemy = game.addPlayer()
  return { game, human, enemy }
}

describe('combat', () => {
  it('damages a faced enemy on the same tick with a bullet', () => {
    const { game, human, enemy } = battle()
    game.spawn(human, UnitTypeId.Scout, { x: 4, y: 4 }, 0)
    const foe = game.spawn(enemy, UnitTypeId.Scout, { x: 4, y: 8 }, 0)
    foe.facing = 0
    const before = foe.health
    const shots = game.tick(1 / 30)
    expect(foe.health).toBe(before - 5)
    expect(shots).toEqual([
      expect.objectContaining({
        kind: WeaponKind.Bullet,
        flight: 0,
        aimX: foe.pos.x,
        aimZ: foe.pos.z,
      }),
    ])
  })

  it('does not fire when the hull is aimed away', () => {
    const { game, human, enemy } = battle()
    game.spawn(human, UnitTypeId.Scout, { x: 4, y: 4 }, Math.PI)
    const foe = game.spawn(enemy, UnitTypeId.Scout, { x: 4, y: 8 }, 0)
    const before = foe.health
    expect(game.tick(1 / 30)).toEqual([])
    expect(foe.health).toBe(before)
  })

  it('holds an empty magazine for five seconds and refills a partial one', () => {
    const { game, human, enemy } = battle()
    const scout = game.spawn(human, UnitTypeId.Scout, { x: 4, y: 4 }, 0)
    const foe = game.spawn(enemy, UnitTypeId.Scout, { x: 4, y: 8 }, 0)
    foe.health = 1000
    let fired = 0
    for (let i = 0; i < 24; i++) fired += game.tick(0.08).length
    expect(fired).toBe(24)
    expect(scout.rounds).toBe(0)
    const held = foe.health
    expect(game.tick(0.08)).toEqual([])
    expect(foe.health).toBe(held)

    scout.facing = Math.PI
    game.tick(5)
    expect(scout.rounds).toBe(24)

    const partial = game.spawn(human, UnitTypeId.Scout, { x: 8, y: 4 }, 0)
    game.spawn(enemy, UnitTypeId.Scout, { x: 8, y: 8 }, 0)
    game.tick(0.08)
    expect(partial.rounds).toBe(23)
    partial.facing = Math.PI
    game.tick(4.9)
    expect(partial.rounds).toBe(23)
    game.tick(0.2)
    expect(partial.rounds).toBe(24)
  })

  it('keeps the turret on an enemy already inside the lock cone', () => {
    const { game, human, enemy } = battle()
    const tank = game.spawn(human, UnitTypeId.MedTank, { x: 10, y: 10 }, 0)
    game.spawn(enemy, UnitTypeId.Scout, { x: 10, y: 16 }, 0)
    game.spawn(enemy, UnitTypeId.Scout, { x: 13, y: 10 }, 0)
    game.tick(0.05)
    expect(Math.abs(tank.turretYaw)).toBeLessThan(0.05)
  })

  it('holds shell damage until the flight time elapses', () => {
    const { game, human, enemy } = battle()
    game.spawn(human, UnitTypeId.MedTank, { x: 2, y: 2 }, 0)
    const foe = game.spawn(enemy, UnitTypeId.Scout, { x: 2, y: 7 }, 0)
    const before = foe.health
    const shots = game.tick(1 / 30)
    expect(shots[0]?.flight).toBeGreaterThan(0)
    expect(foe.health).toBe(before)
    const flight = shots[0].flight
    game.tick(flight - 1 / 30 - 0.02)
    expect(foe.health).toBe(before)
    game.tick(0.06)
    expect(foe.health).toBe(before - 34)
  })

  it('aims a shell ahead of a moving target', () => {
    const { game, human, enemy } = battle()
    game.spawn(human, UnitTypeId.MedTank, { x: 2, y: 2 }, 0)
    const foe = game.spawn(enemy, UnitTypeId.Scout, { x: 2, y: 7 }, 0)
    foe.speed = foe.type.topSpeed
    expect(game.orderMove(enemy.id, foe.id, { x: 2, y: 20 })).toBe(true)
    const shots = game.tick(1 / 30)
    expect(shots[0]?.aimZ).toBeGreaterThan(foe.pos.z + 1)
  })

  it('fires two artillery rounds before the reload', () => {
    const { game, human, enemy } = battle()
    const gun = game.spawn(human, UnitTypeId.Artillery, { x: 2, y: 2 }, 0)
    const foe = game.spawn(enemy, UnitTypeId.Scout, { x: 2, y: 8 }, 0)
    foe.health = 1000
    expect(game.tick(1 / 30)).toHaveLength(1)
    expect(gun.rounds).toBe(1)
    expect(game.tick(0.35)).toEqual([])
    expect(gun.rounds).toBe(1)
    expect(game.tick(0.1)).toHaveLength(1)
    expect(gun.rounds).toBe(0)
    expect(game.tick(0.5)).toEqual([])
    foe.health = 0
    game.tick(6)
    expect(gun.rounds).toBe(2)
  })

  it('closes on an attack order and locks the turret inside commit range', () => {
    const { game, human, enemy } = battle()
    const tank = game.spawn(human, UnitTypeId.MedTank, { x: 2, y: 2 }, 0)
    const far = game.spawn(enemy, UnitTypeId.Scout, { x: 2, y: 20 }, 0)
    expect(game.orderAttack(human.id, tank.id, far.id)).toBe(true)
    expect(tank.attackId).toBe(far.id)
    expect(tank.path.length).toBeGreaterThan(0)
    expect(game.orderAttack(enemy.id, tank.id, far.id)).toBe(false)

    const close = new Game(new World(24, 24))
    const owner = close.addPlayer()
    const other = close.addPlayer()
    const holder = close.spawn(owner, UnitTypeId.MedTank, { x: 4, y: 4 }, 0)
    const prey = close.spawn(other, UnitTypeId.Scout, { x: 4, y: 9 }, 0)
    expect(close.orderAttack(owner.id, holder.id, prey.id)).toBe(true)
    expect(holder.path).toEqual([])
    expect(holder.attackId).toBe(prey.id)
    close.orderMove(owner.id, holder.id, { x: 8, y: 4 })
    expect(holder.attackId).toBeNull()
  })

  it('aims the ordered target inside 1.5 range and ignores it beyond that', () => {
    const near = new Game(new World(24, 24))
    const owner = near.addPlayer()
    const other = near.addPlayer()
    const tank = near.spawn(owner, UnitTypeId.MedTank, { x: 10, y: 10 }, 0)
    near.spawn(other, UnitTypeId.Scout, { x: 10, y: 14 }, 0)
    const ordered = near.spawn(other, UnitTypeId.Scout, { x: 16, y: 10 }, 0)
    expect(near.orderAttack(owner.id, tank.id, ordered.id)).toBe(true)
    near.tick(0.25)
    expect(tank.turretYaw).toBeGreaterThan(0.4)

    const wide = new Game(new World(40, 16))
    const human = wide.addPlayer()
    const enemy = wide.addPlayer()
    const chaser = wide.spawn(human, UnitTypeId.MedTank, { x: 4, y: 4 }, 0)
    wide.spawn(enemy, UnitTypeId.Scout, { x: 4, y: 8 }, 0)
    const distant = wide.spawn(enemy, UnitTypeId.Scout, { x: 24, y: 4 }, 0)
    expect(wide.orderAttack(human.id, chaser.id, distant.id)).toBe(true)
    wide.tick(0.25)
    expect(Math.abs(chaser.turretYaw)).toBeLessThan(0.35)
    expect(chaser.path.length).toBeGreaterThan(0)
    distant.health = 0
    wide.tick(1 / 30)
    expect(chaser.attackId).toBeNull()
  })

  it('fires artillery at a distant enemy only while a friendly unit can see them', () => {
    const { game, human, enemy } = battle()
    const gun = game.spawn(human, UnitTypeId.Artillery, { x: 2, y: 2 }, 0)
    game.spawn(enemy, UnitTypeId.Scout, { x: 2, y: 16 }, 0)
    expect(game.tick(1 / 30)).toEqual([])
    expect(gun.rounds).toBe(2)
    game.spawn(human, UnitTypeId.Scout, { x: 2, y: 10 }, 0)
    const shots = game.tick(1 / 30)
    expect(shots.some((shot) => shot.shooterId === gun.id)).toBe(true)
  })

  it('deals less splash damage farther from the impact', () => {
    const { game, human, enemy } = battle()
    game.spawn(human, UnitTypeId.MedTank, { x: 2, y: 2 }, 0)
    const direct = game.spawn(enemy, UnitTypeId.Scout, { x: 2, y: 7 }, 0)
    const nearby = game.spawn(enemy, UnitTypeId.Scout, { x: 3, y: 7 }, 0)
    const before = direct.health
    const shots = game.tick(1 / 30)
    const flight = shots[0].flight
    game.tick(flight - 1 / 30 - 0.02)
    expect(direct.health).toBe(before)
    game.tick(0.06)
    expect(direct.health).toBe(before - 34)
    expect(nearby.health).toBeLessThan(before)
    expect(nearby.health).toBeGreaterThan(direct.health)
  })
})

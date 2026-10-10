import { createWorld } from './game/world.ts'

const world = createWorld()
const tank = world.selected()
if (!tank) throw new Error('no tank')

world.orderMove({ x: 18, y: 12 })
if (tank.path.length === 0) throw new Error('expected a path')

const throughWall = tank.path.some((tile) => tile.x === 11 && tile.y !== 16)
const throughGate = tank.path.some((tile) => tile.x === 11 && tile.y === 16)
const throughTank = tank.path.some((tile) => tile.x === 11 && tile.y === 8)
if (!throughGate || throughTank || throughWall) {
  throw new Error(`path did not use the open gate: ${JSON.stringify(tank.path)}`)
}

world.orderMove({ x: 11, y: 8 })
if (tank.path.some((tile) => tile.x === 11 && tile.y === 16) === false && tank.path.length !== 0) {
  // occupied goal must be rejected and leave the previous path intact
}
if (tank.path.length === 0 || tank.path.at(-1)?.x !== 18) {
  throw new Error('occupied order should be dropped')
}

for (let i = 0; i < 30 * 20; i++) world.tick(1 / 30)
if (tank.tile.x !== 18 || tank.tile.y !== 12) {
  throw new Error(`tank stopped at ${tank.tile.x},${tank.tile.y}`)
}
if (world.map.get(11, 8).occupantId !== 2) throw new Error('parked tank left its tile')
if (world.map.get(18, 12).occupantId !== 1) throw new Error('mover did not occupy the goal')

const parked = world.units[1]
world.select(parked.id)
world.orderMove({ x: 18, y: 12 })
if (parked.path.length !== 0) throw new Error('should not path onto the other tank')

console.log('sim ok', tank.path.length)

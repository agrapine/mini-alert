import {
  BoxGeometry,
  Color,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
} from 'three'
import type { WorldSnapshot } from '../../shared/protocol.ts'
import { Terrain, scarStrength } from '../../shared/tiles.ts'

export const TILE_TOP = 0.08

const CLEAR_A = new Color(0x667844)
const CLEAR_B = new Color(0x5c703c)
const OBSTACLE = new Color(0x3a342e)
const FOREST = new Color(0x3d9a4a)
const ROAD = new Color(0x667755)
const TOWN = new Color(0x1a1a1a)
const SCAR = new Color(0x6a5840)
const dummy = new Object3D()

export function buildTerrain(world: WorldSnapshot): InstancedMesh {
  const count = world.width * world.height
  const mesh = new InstancedMesh(
    new BoxGeometry(0.98, TILE_TOP, 0.98),
    new MeshStandardMaterial({ roughness: 0.92, metalness: 0 }),
    count,
  )
  paintTerrain(mesh, world)
  mesh.computeBoundingSphere()
  return mesh
}

export function paintTerrain(mesh: InstancedMesh, world: WorldSnapshot) {
  let i = 0
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const terrain = world.terrain[i]
      const known = world.known[i] === 1 && terrain !== Terrain.Water && terrain !== Terrain.Lake
      dummy.position.set(x + 0.5, TILE_TOP / 2, y + 0.5)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(known ? 1 : 0, 1, known ? 1 : 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      mesh.setColorAt(i, tileColor(terrain, x, y))
      i++
    }
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

function tileColor(terrain: Terrain, x: number, y: number): Color {
  if (terrain === Terrain.Forest || terrain === Terrain.Tree) return FOREST
  if (terrain === Terrain.Road) return ROAD
  if (terrain === Terrain.Town) return TOWN
  if (terrain === Terrain.Obstacle) return OBSTACLE
  if (scarStrength(terrain) > 0) return SCAR
  return (x + y) % 2 === 0 ? CLEAR_A : CLEAR_B
}

import {
  BoxGeometry,
  Color,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
} from 'three'
import { Terrain, type Map } from '../map/map.ts'

export const TILE_TOP = 0.08

const CLEAR_A = new Color(0x667844)
const CLEAR_B = new Color(0x5c703c)
const OBSTACLE = new Color(0x3a342e)

export function buildTerrain(map: Map): InstancedMesh {
  const count = map.width * map.height
  const mesh = new InstancedMesh(
    new BoxGeometry(0.98, TILE_TOP, 0.98),
    new MeshStandardMaterial({ roughness: 0.92, metalness: 0 }),
    count,
  )
  const dummy = new Object3D()
  let i = 0
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      dummy.position.set(x + 0.5, TILE_TOP / 2, y + 0.5)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      const color = map.terrainAt(x, y) === Terrain.Obstacle
        ? OBSTACLE
        : (x + y) % 2 === 0
          ? CLEAR_A
          : CLEAR_B
      mesh.setColorAt(i, color)
      i++
    }
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  mesh.computeBoundingSphere()
  return mesh
}

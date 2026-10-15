const CAPACITY = 8
const MAX_DEPTH = 12

type Node = {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  index: number[]
  x: number[]
  z: number[]
  child: number
  depth: number
}

export class Quad {
  private readonly nodes: Node[] = []
  private used = 0

  clear(width: number, height: number) {
    this.used = 1
    const root = this.ensure(0)
    root.minX = -1
    root.minZ = -1
    root.maxX = width + 1
    root.maxZ = height + 1
    root.index.length = 0
    root.x.length = 0
    root.z.length = 0
    root.child = -1
    root.depth = 0
  }

  insert(index: number, x: number, z: number) {
    if (this.used === 0) return
    this.insertAt(0, index, x, z)
  }

  seek(minX: number, minZ: number, maxX: number, maxZ: number, out: number[]) {
    if (this.used === 0) return
    this.seekAt(0, minX, minZ, maxX, maxZ, out)
  }

  private insertAt(nodeIndex: number, index: number, x: number, z: number) {
    const node = this.nodes[nodeIndex]
    if (node.child !== -1) {
      this.insertAt(this.childOf(node, x, z), index, x, z)
      return
    }
    node.index.push(index)
    node.x.push(x)
    node.z.push(z)
    if (node.index.length > CAPACITY && node.depth < MAX_DEPTH) this.split(nodeIndex)
  }

  private split(nodeIndex: number) {
    const node = this.nodes[nodeIndex]
    const indices = node.index
    const xs = node.x
    const zs = node.z
    node.index = []
    node.x = []
    node.z = []
    const midX = (node.minX + node.maxX) * 0.5
    const midZ = (node.minZ + node.maxZ) * 0.5
    const child = this.used
    this.used += 4
    const boxes = [
      [node.minX, node.minZ, midX, midZ],
      [midX, node.minZ, node.maxX, midZ],
      [node.minX, midZ, midX, node.maxZ],
      [midX, midZ, node.maxX, node.maxZ],
    ]
    for (let i = 0; i < 4; i++) {
      const next = this.ensure(child + i)
      next.minX = boxes[i][0]
      next.minZ = boxes[i][1]
      next.maxX = boxes[i][2]
      next.maxZ = boxes[i][3]
      next.index.length = 0
      next.x.length = 0
      next.z.length = 0
      next.child = -1
      next.depth = node.depth + 1
    }
    node.child = child
    for (let i = 0; i < indices.length; i++) this.insertAt(nodeIndex, indices[i], xs[i], zs[i])
  }

  private childOf(node: Node, x: number, z: number): number {
    const midX = (node.minX + node.maxX) * 0.5
    const midZ = (node.minZ + node.maxZ) * 0.5
    const east = x >= midX ? 1 : 0
    const south = z >= midZ ? 1 : 0
    return node.child + east + south * 2
  }

  private seekAt(nodeIndex: number, minX: number, minZ: number, maxX: number, maxZ: number, out: number[]) {
    const node = this.nodes[nodeIndex]
    if (maxX < node.minX || maxZ < node.minZ || minX > node.maxX || minZ > node.maxZ) return
    if (node.child === -1) {
      for (let i = 0; i < node.index.length; i++) {
        const x = node.x[i]
        const z = node.z[i]
        if (x < minX || z < minZ || x > maxX || z > maxZ) continue
        out.push(node.index[i])
      }
      return
    }
    for (let i = 0; i < 4; i++) this.seekAt(node.child + i, minX, minZ, maxX, maxZ, out)
  }

  private ensure(index: number): Node {
    const found = this.nodes[index]
    if (found) return found
    const node: Node = {
      minX: 0,
      minZ: 0,
      maxX: 0,
      maxZ: 0,
      index: [],
      x: [],
      z: [],
      child: -1,
      depth: 0,
    }
    this.nodes[index] = node
    return node
  }
}

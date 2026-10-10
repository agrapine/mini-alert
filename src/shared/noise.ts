export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function valueNoise(x: number, y: number, seed: number, scale = 0.08): number {
  const sx = x * scale
  const sy = y * scale
  const x0 = Math.floor(sx)
  const y0 = Math.floor(sy)
  const tx = sx - x0
  const ty = sy - y0
  const u = tx * tx * (3 - 2 * tx)
  const v = ty * ty * (3 - 2 * ty)
  const a = lattice(x0, y0, seed)
  const b = lattice(x0 + 1, y0, seed)
  const c = lattice(x0, y0 + 1, seed)
  const d = lattice(x0 + 1, y0 + 1, seed)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function lattice(x: number, y: number, seed: number): number {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

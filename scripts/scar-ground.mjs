import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 256
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../assets/ground')

const VARIANTS = [
  { name: 'a', seed: 4102, counts: [3, 3, 4] },
  { name: 'b', seed: 7907, counts: [4, 2, 4] },
]

mkdirSync(OUT, { recursive: true })
for (const variant of VARIANTS) {
  const marks = layout(variant.seed, variant.counts)
  for (let strength = 1; strength <= 3; strength++) {
    const png = encodePng(paint(marks.filter((mark) => mark.band <= strength)))
    writeFileSync(join(OUT, `scar-${strength}${variant.name}.png`), png)
  }
}

function layout(seed, counts) {
  const rng = mulberry32(seed)
  const marks = []
  for (let band = 1; band <= 3; band++) {
    for (let i = 0; i < counts[band - 1]; i++) marks.push(crater(rng, band, i === 0 && band > 1))
    const gouges = band === 1 ? 0 : band === 2 ? 2 : 3
    for (let i = 0; i < gouges; i++) marks.push(gouge(rng, band))
    const chips = band === 1 ? 10 : 14
    for (let i = 0; i < chips; i++) marks.push(chip(rng, band))
  }
  return marks
}

function crater(rng, band, heavier) {
  const radius = heavier ? 0.11 + rng() * 0.05 : 0.055 + rng() * (band === 1 ? 0.045 : 0.03)
  return {
    kind: 'hole',
    band,
    x: 0.16 + rng() * 0.68,
    y: 0.16 + rng() * 0.68,
    rx: radius * (0.85 + rng() * 0.4),
    ry: radius * (0.7 + rng() * 0.35),
    rot: rng() * Math.PI,
    jag: 0.18 + rng() * 0.22,
    phase: rng() * 20,
  }
}

function gouge(rng, band) {
  const length = 0.08 + rng() * 0.1
  return {
    kind: 'gouge',
    band,
    x: 0.14 + rng() * 0.72,
    y: 0.14 + rng() * 0.72,
    rx: length,
    ry: length * (0.16 + rng() * 0.1),
    rot: rng() * Math.PI,
    jag: 0.08,
    phase: rng() * 20,
  }
}

function chip(rng, band) {
  const radius = 0.012 + rng() * 0.02
  return {
    kind: 'chip',
    band,
    x: 0.08 + rng() * 0.84,
    y: 0.08 + rng() * 0.84,
    rx: radius,
    ry: radius * (0.6 + rng() * 0.5),
    rot: rng() * Math.PI,
    jag: 0.1,
    phase: rng() * 20,
    light: rng() > 0.45,
  }
}

function paint(marks) {
  const rgba = new Float32Array(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = (x + 0.5) / SIZE
      const py = (y + 0.5) / SIZE
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (const mark of marks) {
        const t = field(px, py, mark)
        const stamp = mark.kind === 'hole' ? hole(t, mark, px, py) : mark.kind === 'gouge' ? furrow(t) : pebble(t, mark)
        if (!stamp) continue
        const ia = 1 - stamp.a
        r = stamp.r * stamp.a + r * ia
        g = stamp.g * stamp.a + g * ia
        b = stamp.b * stamp.a + b * ia
        a = stamp.a + a * ia
      }
      const i = (y * SIZE + x) * 4
      rgba[i] = r
      rgba[i + 1] = g
      rgba[i + 2] = b
      rgba[i + 3] = a
    }
  }
  return rgba
}

function hole(t, mark, px, py) {
  if (t > 2.7) return null
  const scorch = smooth(2.7, 1.05, t)
  const soil = smooth(1.28, 0.72, t) * (1 - smooth(0.72, 0.5, t) * 0.35)
  const bowl = smooth(0.92, 0.48, t)
  const pit = smooth(0.5, 0.12, t)
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  lay(scorch * 0.72, 54, 46, 30)
  lay(soil * 0.9, 124, 96, 58)
  const lx = (px - mark.x) / mark.rx
  const ly = (py - mark.y) / mark.ry
  const lit = clamp(0.45 + lx * 0.35 + ly * 0.35)
  const rim = smooth(0.7, 0.95, t) * (1 - smooth(0.95, 1.18, t))
  lay(rim * lit * 0.85, 168, 140, 96)
  lay(rim * (1 - lit) * 0.7, 62, 46, 30)
  lay(bowl * 0.95, 36, 28, 20)
  lay(pit, 14, 11, 9)
  return a > 0.004 ? { r, g, b, a } : null

  function lay(alpha, cr, cg, cb) {
    if (alpha <= 0) return
    const ia = 1 - alpha
    r = (cr / 255) * alpha + r * ia
    g = (cg / 255) * alpha + g * ia
    b = (cb / 255) * alpha + b * ia
    a = alpha + a * ia
  }
}

function furrow(t) {
  if (t > 1.8) return null
  const body = smooth(1.8, 0.35, t)
  return { r: 48 / 255, g: 38 / 255, b: 26 / 255, a: body * 0.78 }
}

function pebble(t, mark) {
  if (t > 1.15) return null
  const body = smooth(1.15, 0.2, t)
  return mark.light
    ? { r: 150 / 255, g: 124 / 255, b: 86 / 255, a: body * 0.8 }
    : { r: 40 / 255, g: 32 / 255, b: 24 / 255, a: body * 0.85 }
}

function field(px, py, mark) {
  const dx = px - mark.x
  const dy = py - mark.y
  const c = Math.cos(mark.rot)
  const s = Math.sin(mark.rot)
  let lx = dx * c + dy * s
  let ly = -dx * s + dy * c
  const ang = Math.atan2(ly, lx)
  const jag = 1 + mark.jag * (noise(Math.cos(ang) * 2.4 + mark.phase, Math.sin(ang) * 2.4) - 0.5)
  lx /= mark.rx * jag
  ly /= mark.ry * jag
  return Math.hypot(lx, ly)
}

function noise(x, y) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash2(x0, y0)
  const b = hash2(x0 + 1, y0)
  const c = hash2(x0, y0 + 1)
  const d = hash2(x0 + 1, y0 + 1)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

function hash2(ix, iy) {
  let n = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

function smooth(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function clamp(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function encodePng(rgba) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
  for (let y = 0; y < SIZE; y++) {
    const row = y * (SIZE * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < SIZE; x++) {
      const src = (y * SIZE + x) * 4
      const dst = row + 1 + x * 4
      raw[dst] = Math.round(clamp(rgba[src]) * 255)
      raw[dst + 1] = Math.round(clamp(rgba[src + 1]) * 255)
      raw[dst + 2] = Math.round(clamp(rgba[src + 2]) * 255)
      raw[dst + 3] = Math.round(clamp(rgba[src + 3]) * 255)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(SIZE, 0)
  ihdr.writeUInt32BE(SIZE, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([length, body, crc])
}

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c
}

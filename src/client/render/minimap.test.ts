// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import type { WorldSnapshot } from '../../shared/protocol.ts'
import { Terrain } from '../../shared/tiles.ts'
import { Minimap, type MinimapCommand } from './minimap.ts'

const WIDTH = 40
const HEIGHT = 20

function world(): WorldSnapshot {
  return {
    width: WIDTH,
    height: HEIGHT,
    terrain: Array<Terrain>(WIDTH * HEIGHT).fill(Terrain.Land),
    known: new Uint8Array(WIDTH * HEIGHT).fill(1),
    shifts: new Uint8Array(WIDTH * HEIGHT),
    coast: [],
    holes: [],
    roads: [],
    towns: [],
    seed: 0,
  }
}

function mount() {
  const root = document.createElement('div')
  const map = document.createElement('canvas')
  const marks = document.createElement('canvas')
  root.append(map, marks)
  document.body.replaceChildren(root)
  const context = {
    createImageData: (width: number, height: number) => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
    putImageData: () => undefined,
  }
  map.getContext = (() => context) as unknown as HTMLCanvasElement['getContext']
  root.getBoundingClientRect = () => new DOMRect(100, 50, 200, 100)
  const jump = vi.fn<(x: number, z: number) => void>()
  const command = vi.fn<MinimapCommand>()
  new Minimap(root, map, marks, world(), jump).setCommand(command)
  return { marks, jump, command }
}

function pointer(target: Element, type: string, clientX: number, clientY: number, init: PointerEventInit = {}): boolean {
  return target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX, clientY, ...init }))
}

describe('minimap pointer', () => {
  it('jumps to the point under a press and follows a drag while a button is held', () => {
    const { marks, jump } = mount()
    pointer(marks, 'pointerdown', 150, 75, { button: 0, buttons: 1 })
    pointer(marks, 'pointermove', 200, 100, { buttons: 1 })
    expect(jump.mock.calls).toEqual([
      [10, 5],
      [20, 10],
    ])
  })

  it('stops following on a move with no button held', () => {
    const { marks, jump } = mount()
    pointer(marks, 'pointerdown', 150, 75, { button: 0, buttons: 1 })
    pointer(marks, 'pointermove', 160, 80, { buttons: 0 })
    pointer(marks, 'pointermove', 200, 100, { buttons: 1 })
    expect(jump.mock.calls).toEqual([[10, 5]])
  })

  it('commands the tile under a right press with its modifiers, and keeps the context menu shut', () => {
    const { marks, jump, command } = mount()
    pointer(marks, 'pointerdown', 157, 99, { button: 2, buttons: 2, shiftKey: true })
    expect(jump).not.toHaveBeenCalled()
    expect(command).toHaveBeenCalledOnce()
    const [tile, mods] = command.mock.calls[0]
    expect(tile).toEqual({ x: 11, y: 9 })
    expect(mods).toMatchObject({ shiftKey: true, ctrlKey: false, metaKey: false })
    expect(marks.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))).toBe(false)
  })
})

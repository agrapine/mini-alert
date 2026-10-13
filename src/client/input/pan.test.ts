import { describe, expect, it } from 'vitest'
import { PanButton, PanDrag } from './pan.ts'

describe('pan drag', () => {
  it('ends a middle-button pan released while the left button is still down', () => {
    const pan = new PanDrag()
    pan.begin(PanButton.Middle)
    expect(pan.track(PanButton.Middle | PanButton.Left)).toBe(true)
    expect(pan.track(PanButton.Left)).toBe(false)
  })
})

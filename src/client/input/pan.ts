export const enum PanButton {
  Left = 1,
  Middle = 4,
}

/** A drag-pan ends as soon as the button that started it is no longer held, whichever event reports that. */
export class PanDrag {
  private mask = 0

  get active(): boolean {
    return this.mask !== 0
  }

  begin(button: PanButton) {
    this.mask = button
  }

  track(buttons: number): boolean {
    if ((buttons & this.mask) === 0) this.mask = 0
    return this.active
  }

  end() {
    this.mask = 0
  }
}

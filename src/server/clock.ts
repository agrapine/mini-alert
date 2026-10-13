const MAX_CATCH_UP = 10

/** Runs `tick` once per `stepMs` of wall time, catching up after a slow step and dropping time beyond MAX_CATCH_UP steps. */
export function runFixedStep(
  stepMs: number,
  tick: () => void,
  now: () => number = () => performance.now(),
  wait: (run: () => void, ms: number) => void = (run, ms) => setTimeout(run, ms),
) {
  let due = now()
  const pump = () => {
    const start = now()
    if (start - due > stepMs * MAX_CATCH_UP) due = start - stepMs * MAX_CATCH_UP
    while (due <= start) {
      tick()
      due += stepMs
    }
    wait(pump, Math.max(0, due - now()))
  }
  pump()
}

# AI harness

`npm run ai` plays a match with every seat controlled by the AI. It uses the same server, fog, and orders as a live game, and it does not wait on the wall clock. One simulated step is issued as soon as the previous one finishes, so a 20 minute match takes seconds of real time.

```bash
npm run ai
npm run ai -- --seed 42 --minutes 10
npm run ai -- --size small --players 4 --quiet
```

The dashboard shows simulated time, how many times faster than realtime the run is, and one row per bot: credits, population, supply, cities, army, and the lanes it considered on its last decision. A short log under that lists each new thought. `--quiet` skips the dashboard and prints a one-line status each simulated minute. Either way the process ends with a summary: who is still standing, sim time, wall time, and the speedup.

The run stops when one bot is left with units or cities, when `--minutes` of simulated time elapses (default 20), or when you press Ctrl-C.

## Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `--seed` | random | Map seed. Printed in the summary so a game can be repeated. Tiny maps sometimes collapse; the harness then tries the next seeds and reports the one it used. |
| `--size` | `tiny` | `tiny` (64), `small` (128), `medium` (192), or `large` (256). |
| `--players` | 2 | AI seats. Capped by the map (2, 4, 6, or 8). |
| `--minutes` | 20 | Simulated minutes before the match is called. |
| `--pace` | 1 | How often bots think, on the same scale as the lobby pace slider. |
| `--log` | `ai-trace.jsonl` | Thought trace. Replaced at the start of each run. |
| `--quiet` | off | Log and summary only, no dashboard. |

Pass flags after `--` so npm forwards them: `npm run ai -- --seed 7`.

## Thought trace

`ai-trace.jsonl` is one JSON object per line.

- `start` records the seed, size, player count, minute limit, and pace.
- `think` is one decision: `t` is simulated seconds, then `player`, `name`, `candidates`, and the `orders` that were sent.
- `end` records why the match stopped, the speedup, and who was still standing.

Each candidate has a `lane` (`home`, `contact`, or `march`), a `scenario` (build, garrison, train, defend, explore, capture, assault), a score, a tile, how many orders it issued, and `blocked`. An empty `blocked` string means that lane acted. `holding` in the dashboard means it is already doing the job, so it sent no new order. Block reasons are `pop`, `no site`, `no target`, and `army too small`.

Diff the trace between runs when changing `src/ai/scenarios.ts`. A bot that cannot afford a factory shows `home build blocked: pop`, then either holds a unit in a city that can still grow or sends a scout to capture or explore.

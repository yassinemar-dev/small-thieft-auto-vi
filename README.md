# Small Thief Auto VI

A browser-based, GTA VI-inspired 3D Vice City game built with Three.js and Vite. Drive, explore, cause trouble, outrun the police and run checkpoint routes — all rendered in real 3D with a GTA-style HUD.

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:5173/>. Use `npm run build` for a production bundle.

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / Arrows | Move, drive and steer |
| `F` | Enter or exit the nearest vehicle |
| `R` | Repair damage and restore health/armor |
| `Shift` | Run |
| `Space` | Handbrake while driving |
| `M` | Start a new Vice Run checkpoint mission |
| `Esc` / `P` | Pause menu (resume or restart) |
| Mouse | Look around (click the canvas to lock the pointer) |

## Features

- **Vice Run missions** — five glowing checkpoints, per-checkpoint cash, a decaying time bonus and automatic restart after completion.
- **Wanted system** — crashes and pedestrian hits raise up to five stars; nearby traffic turns into pursuing police cruisers with flashing red/blue lightbars and ramming AI.
- **Death and respawn** — a `WASTED` screen, hospital bill, cleared wanted level and respawn near the starter car.
- **Driving model** — acceleration, reverse, speed-sensitive steering, handbrake, body roll, wheel spin, collisions, brake lights, damage tint and engine smoke.
- **Living city** — 43 lane-following AI cars with intersection turns and traffic lights, 64 sidewalk pedestrians who dodge cars and panic-run from fast vehicles or police.
- **Performance-conscious rendering** — instanced cars and pedestrians, instanced props/decals, MSAA, half-float post-processing, subtle film grade and speed-sensitive motion blur.
- **Atmosphere** — sunset sky, drifting clouds, lens flare, fog, palms, parks, awnings, neon shop signs, streetlight glow, rooftop props and zebra crossings.
- **HUD** — rotating minimap with an honest compass, wanted stars, cash, district label, health/armor bars, speedometer, mission panel, notifications and damage flashes.
- **Audio** — synthesized engine note, police siren, crashes, impacts, checkpoints, mission completion and wanted alerts; no external sound files.
- **Pause menu** — freezes the simulation and offers resume or a clean full restart.

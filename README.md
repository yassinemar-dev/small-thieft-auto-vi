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
| `R` | Reload the pistol on foot; repair the car and restore health/armor otherwise |
| `Shift` | Run |
| `Space` | Handbrake while driving |
| `M` | Skip to the next job (Vice Run / Courier / Takedown) |
| `N` | Cycle car radio: off / Vice FM / Wave 103 / Los Santos |
| `J` | Fire the pistol (keyboard alternative to the mouse) |
| `Esc` / `P` | Pause menu (resume or restart) |
| Mouse | Look around (click the canvas to lock the pointer) · left button fires |

## Features

- **Three rotating jobs** — Vice Run (five checkpoints), Courier (three pickup/drop-off stops) and Takedown (ram a marked car until wrecked), each with per-objective cash, a decaying time bonus and automatic rotation after completion. Press `M` to skip to the next job.
- **Wanted system** — crashes, gunfire and pedestrian hits raise up to five stars; nearby traffic turns into pursuing police cruisers with flashing red/blue lightbars and ramming AI, and from three stars they return fire when they have a clear line of sight.
- **Drive-by pistol** — hold the left mouse button (or `J`) to fire from the driver's side or on foot, with pooled tracers, sparks, a muzzle flash, a 12-round magazine, timed reloads and hits that damage cars, down pedestrians and advance Takedown jobs.
- **Death and respawn** — a `WASTED` screen, hospital bill, cleared wanted level and respawn near the starter car.
- **Driving model** — acceleration, reverse, speed-sensitive steering, handbrake, body roll, wheel spin, collisions, brake lights, night-reactive headlamps, damage tint, engine smoke, and engine fires that end in an explosion, a wrecked car and a forced exit.
- **Living city** — 43 lane-following AI cars with intersection turns and traffic lights, 64 sidewalk pedestrians who dodge cars and panic-run from fast vehicles, police sirens or gunfire. Cars use rounded clearcoat bodies, wheel arches, hubcaps, brake calipers, mirrors, door seams and handles, grille slats, bumpers, splitters, exhausts, indicators, tail bars, licence plates, lip spoilers, visible interiors with steering wheels and wipers, police door liveries, taxi roof signs and soft contact shadows. Paint, glass and chrome sample a shared sky reflection, and night traffic casts soft volumetric headlight beams.
- **Performance-conscious rendering** — instanced cars and pedestrians, instanced props/decals, MSAA, half-float post-processing, subtle film grade and speed-sensitive motion blur.
- **Atmosphere** — a six-minute day-night cycle from golden hour through dusk to blue hour, driving sky colours, fog, sun angle, exposure, bloom and window/neon brightness; a star field and cratered moon fade in after dark while asphalt turns glassy, shop signs smear across the wet street and streetlights cast volumetric cones and traffic lays warm headlight spill across the road; plus drifting clouds, lens flare, palms, parks, awnings, rooftop props and zebra crossings.
- **HUD** — rotating minimap with an honest compass, live traffic, flashing police dots, a dashed route through remaining objectives, wanted stars, cash, in-game clock, district label, health/armor bars, speedometer, radio station, ammo counter, crosshair, mission panel, notifications and damage flashes.
- **Audio** — synthesized engine note, police siren, crashes, impacts, checkpoints, mission completion and wanted alerts, plus three generative in-car radio stations with a lookahead scheduler; no external sound files.
- **Career progression** — distance, playtime, jobs, crashes, wrecks, cop escapes, shots and earnings are tracked in local storage, with seven unlockable achievements that pay cash; the pause menu shows the full record and can reset the career.
- **Pause menu** — freezes the simulation and offers resume, a clean full restart or a career reset.

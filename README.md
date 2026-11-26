# Small Thief Auto VI

A browser-based, GTA VI-inspired 3D open-world game built with Three.js and Vite.

## Run locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173/

## Controls

| Key | Action |
| --- | --- |
| `W A S D` / Arrows | Move / drive / steer |
| `F` | Enter or exit the nearest vehicle |
| `R` | Repair and restore health/armor |
| `Shift` | Run |
| `Space` | Handbrake while driving |
| Mouse | Orbit camera (click the canvas to lock the pointer) |

## Features

- Instanced pedestrian crowd: 64 animated walkers rendered in 10 draw calls
- Third-person camera with obstacle avoidance, shake and over-the-shoulder framing
- Detailed articulated player character with walk/run and seated driving animation
- Drivable vehicles with steering, acceleration, handbrake and collisions
- Lane-following AI traffic (42 cars) with intersection turns, spacing and traffic lights
- Sidewalk pedestrians (64 walkers) moving in both directions, turning at corners and dodging cars
- Wider avenues, open parks, shop awnings/neon signs, street bins, textured roads/sidewalks, zebra crossings, art-deco bands, rooftop props, palms and streetlights
- Vice City sunset sky with drifting clouds, distant hills, lens flare and speed-sensitive motion blur
- GTA VI-style HUD: circular minimap, wanted stars, health/armor bars and speedometer

# Titan F1 Pit Dashboard

A full-screen pit display for FIRST Tech Challenge team **7831 Titan F1**, built to run on a Raspberry Pi 3 inside a pi-top CEED. It pulls live event data from [FTCScout](https://ftcscout.org), keeps working from cache when the venue Wi-Fi drops, and shows judges a 3D model of our robot.

**Live demo:** https://lilrino71.github.io/ftc-pit-dashboard/

## Screens

| Key | Screen | What it shows |
|---|---|---|
| `1` | Dashboard | Next match countdown, alliance partner and opponents with OPR, an OPR-based prediction, our rank/record, score graph, our schedule, rankings, and a flashing **QUEUE NOW** banner. Before the schedule is out, a scouting board ranks every registered team by its best OPR this season. |
| `2` | Judges | Our robot CAD in 3D on a turntable that cycles into an exploded view, next to rotating talking points |
| `3` | Match timer | 0:30 auto, 0:08 pick up controllers, 2:00 teleop with an endgame warning and beeps |
| `4` | Checklist | Pre-match checklist; tick items with letter keys or the mouse |
| `S` | Settings | Team number, event code, "find our events", demo mode |

Other keys: `R` refreshes, `Esc` goes back to the dashboard, `F` toggles full screen.

## Setup

1. Edit `config.js`: team, event code, checklist, judge slides and the robot model path.
2. Serve the folder (the 3D model needs http): `python pi/serve.py 8770 .`, then open http://localhost:8770.
3. URL options: `?team=7831&event=USCALAMVS4&season=2026`, `?demo=1`, `?view=judge`, `?fx=0` to force the low-power look.

### On the Raspberry Pi

```bash
bash ftc-pit-dashboard/pi/setup.sh
sudo reboot
```

This copies the dashboard to `~/ftc-pit-dashboard`, runs a small local web server as a user service, and starts Chromium in kiosk mode on boot. `bash ~/ftc-pit-dashboard/pi/remove.sh` undoes it.

## Design notes

- Plain HTML/CSS/JS with no build step. three.js and the fonts are vendored, so it runs offline.
- **Glass only where it belongs:** the floating dock and top bar are frosted glass. Content panels are near-opaque so text never sits on raw glass.
- **Fake glass on the Pi:** live `backdrop-filter` roughly halves frame rate on Pi-class GPUs, so on ARM Linux the glass look comes from static layers: a pre-blurred robot render, translucent gradient fill, 1px highlight and a 5% grain tile. Real blur turns on for desktop browsers.
- **Avoiding the generic AI look:** one brass accent (no purple/indigo, no neon glows), Barlow Condensed for numbers and headings instead of default Inter, an asymmetric layout sized by importance, alliance colour shown with a swatch *and* a word, and real empty/loading/offline states.
- **3D on a Pi 3:** no shadow maps (a painted contact shadow instead), capped pixel ratio, a decimated meshopt-compressed model, and an FPS watchdog that drops resolution if the Pi can't keep up.

## Robot model

Judge mode loads `models/robot.glb` on desktops and the lighter `models/robot-pi.glb` on the Pi. Both come from the team's Onshape "Meet 0 Robot" assembly:

1. Export the assembly from Onshape as glTF (about 380 MB, 26 million triangles).
2. `cd tools && npm install`
3. `node build_robot.mjs robot.gltf ../models/robot.glb 12 0.01 0.08` (desktop, about 270k triangles)
4. `node build_robot.mjs robot.gltf ../models/robot-pi.glb 12 0.01 0.05` (Pi, about 180k triangles)

The converter drops parts under 12 mm (screws, pins), merges each part's faces and simplifies it to a triangle budget scaled to its size, bakes part colours into vertex colours, and groups everything by subassembly so each group is one draw call and one piece of the exploded view. Judge mode rebuilds creased normals when it loads.

## Data

- FTCScout REST API: `/events/{season}/{code}`, `/matches`, `/teams`, and `/teams/{n}/events/{season}` for scouting.
- Every response is cached in `localStorage`; if a request fails, the last good data is shown with a "cached" status.
- Demo mode replays the 2025 Alabama Championship with the clock shifted to 7 minutes before one of a team's matches.

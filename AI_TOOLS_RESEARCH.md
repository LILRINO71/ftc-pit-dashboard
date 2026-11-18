# AI agent tools: CLI-Anything and REA for ftc-pit-dashboard (Titan F1 7831)

Research note, 2026-11-17. It covers two agent toolkits:

- **[CLI-Anything](https://github.com/HKUDS/CLI-Anything)** (Apache-2.0) wraps real desktop programs (FreeCAD, Blender, 3MF and others) in CLIs that agents can drive.
- **[REA](https://github.com/morluto/rea)** (MIT) is an MCP server and CLI that gives agents reverse-engineering tools.

This file covers only what matters for **this** repo.

How to read the labels:

- **Confirmed**: checked against the tool's own repo or docs.
- **Recommendation**: a suggestion, not tested.
- Nothing below was run end to end on this project yet.

## What could help here

| Tool | Use in this repo | Value |
|---|---|---|
| CLI-Anything **Blender** harness | Decimate `models/robot.glb` (909 KB) further for slow display hardware. The `robot-pi.glb` (611 KB) was made by hand; this could make the step repeatable | Low-Medium |
| REA **JS analysis** | Check what the deployed site ships (no keys in `config.js`, no stray source maps) | Medium |
| REA **HAR / website observation** | Use only on **our own** dashboard. For FTCScout, use its documented public API. Don't reverse private endpoints | Low |

## Proposed changes (not made yet)

1. Add a one-line check to the README's deploy steps: run REA on the built site, then confirm no secrets are shipped.

## Status on the dev PC (2026-11-17)

- **Installed:** the agent skills `cli-hub-meta-skill` and `reverse-engineer-anything`, plus `cli-anything-hub` 0.4.1 (pip).
- **Not usable yet:**
  - The REA CLI/MCP needs Node 24.22.1 or newer, and the PC has 24.15.0.
  - The FreeCAD/Blender harnesses need those programs installed. Neither is.

## Rules for REA

Use REA only on code and builds we made, or on devices we own. Reverse engineering commercial software can break its EULA or DMCA §1201, and §1201(f) covers only narrow interoperability work. REA's tool results are sent to the AI model provider, so never point it at keys, `.env` files or credentials.

# App logo and icons

The user-approved steering-wheel/controller logo, with no vehicle depiction,
manufacturer logo, product photography or recognizable model styling.

Generated with the built-in `image_gen` tool in **generation** mode, with a
transparent background. `source.png` is the approved original. Run
`bash packaging/build-icons.sh` on macOS to fit it proportionally on a transparent
square canvas and pack the native formats:

- `wltoys-drive.png`: Linux desktop shortcut
- `wltoys-drive.icns`: both macOS app bundles
- `wltoys-drive.ico`: Windows executable, player window and taskbar

The README composition uses the same PNG as the app icons through `assets/readme/build.swift`.

## Final generation prompt

Use case: logo-brand. Make ONE standalone logo concept for an independent driving-controller app. Subject: a generic steering-wheel controller, combining a simple three-spoke steering wheel with subtle gamepad controls. Bold circular wheel rim, a small central hub, three clean spokes. The left horizontal spoke has a tiny plus-shaped directional pad; the right horizontal spoke has two small round controller buttons. The bottom spoke is a single short vertical bar. Use a charcoal-black silhouette, clean white negative space, and one small restrained red accent at the central hub. Design it as a coherent, simple, flat geometric logo that could be drawn in a few SVG paths, with rounded joins and balanced proportions. It must immediately read as a steering wheel used to control a game, not a compass or navigation arrow. Center the mark on a transparent background, with generous clear space. This is an early logo design study, NOT a finished app icon: no background tile, no rounded-square container, no shadows, no bevels, no 3D render, no glossy material. No vehicle, no car, no manufacturer imagery, no recognizable branded controller, no logos, no letters, no words, no button labels, no watermark, no mockup.

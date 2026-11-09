# Echoes of the Asylum: Granny & Mundiya

A first-person 3D psychological horror survival game. You have five days to escape a
decaying asylum while two hunters work the corridors: **Granny**, who hears everything,
and **Mundiya**, a silent shadow that walks through walls.

Built with TypeScript, three.js and WebAudio. Every texture, model and sound is generated
at runtime, so the game ships with no external assets.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle into dist/
npm test           # vitest logic suite (23 tests)
```

## Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrows | Move |
| `Shift` | Sprint (loud — Granny hears it) |
| `Ctrl` / `C` | Crouch (quiet, slower) |
| `E` | Interact: take item, use objective |
| `F` | Toggle flashlight |
| `T` | Arm a bear trap where you stand |
| `1` `2` `3` | Drop the item in that satchel slot |
| `H` | Toggle the controls overlay |
| `M` | Mute audio |
| `Esc` | Pause |

Click the screen to capture the mouse. The satchel holds **three items**, so you will
have to drop tools before hauling three fuse pieces.

## Rules

- **Five days.** Each time a hunter catches you, a day passes: the loose items are
  reshuffled into new rooms, security rises (hunters move faster and hear further), and
  the hunters return to their posts. The fifth catch ends the run.
- **Three-item satchel.** Keys, tools, fuses and relics compete for the same slots.
  Tools such as the crowbar and wrench stay in hand after use; fuses, relics and keys
  are consumed by the fixture that needs them.
- **Sound matters.** Sprinting, dropping items, forcing a vent and stepping on creaking
  floorboards all emit noise that Granny investigates. Crouching is silent.
- **Light matters.** Mundiya tracks by sight and by your flashlight; the closer it gets,
  the more the world warps and the lights stutter. Cutting the light hides you from it.

## Hunters

**Granny** patrols fixed corridors, hears noise within her radius, and chases on sight.
She pathfinds around walls, so you can break line of sight and double back. A bear trap
stuns her for six seconds.

**Mundiya** never hears you. It sees across open ground, homes in on a lit player, and
phases through walls without pathfinding. Its approach drives the post-processing
distortion, heartbeat and light flicker.

## Levels

1. **The Basement & Quarantine Wards** — find the rusted key, cut the electric shock-wire
   with wire cutters, and collect the flashlight. Creaking floorboards betray you.
2. **The Hall of Locked Chambers & Mortuary** — recover the three coloured fuse pieces to
   restore elevator power, and pry the ventilation shaft open with the crowbar. Mundiya
   phases through walls here.
3. **The Twisted Chapel & Ritual Archive** — place four ritual relics in their matching
   altar slots. Hidden bear traps and disorienting chapel bells.
4. **The Clocktower & Final Escape** — fix the clock gears with the master wrench, take
   the gate key from inside the clock face, and open the perimeter gate before Day 5 ends.
   Both hunters are loose on the roof.

## Presentation

- Volumetric-feeling fog (`FogExp2`) tuned per level, dust motes, rain and lightning on
  the roof, and flickering lamp cones.
- A custom post-processing pass adds barrel warp, chromatic aberration, film grain,
  vignette and a heartbeat pulse that intensify with Mundiya's proximity.
- All audio is synthesised: footsteps with reverb tails, whispers, chapel bells,
  jump-scare stingers, trap snaps and a dynamic heartbeat that quickens with threat.

## Architecture

```
src/game/     pure rules: map generation, pathing, inventory, hunters, session, levels
src/render/   three.js world, hunter models, procedural textures, horror post-processing
src/audio/    WebAudio synthesis graph (noise, reverb, heartbeat, stingers)
src/ui/       HUD and overlay panels
src/main.ts   loop, input, pointer lock, transitions
tests/        vitest suites for inventory, day cycle, hunters and a full playthrough
```

The `src/game` layer has no DOM or three.js dependency, which is why the whole game
loop — including a scripted four-level escape — is covered by fast unit tests.

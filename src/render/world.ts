import * as THREE from 'three';
import { ITEMS } from '../game/items';
import type { PlacedObjective, WorldItem } from '../game/layout';
import { CELL, MAP_H, MAP_W, WALL_HEIGHT, type GameMap } from '../game/mapgen';
import { mulberry32 } from '../game/rng';
import type { GameSession } from '../game/session';
import type { HunterId, ThemeId } from '../game/types';
import { createGrannyView, createMundiyaView, type HunterView } from './hunters3d';
import { glowTexture, graffitiTexture, grungeTexture } from './textures';

interface Palette {
  floor: string;
  floorDark: string;
  floorLight: string;
  wall: string;
  wallDark: string;
  wallLight: string;
  ceiling: number;
  lamp: number;
  dust: number;
  prop: number;
  planks: boolean;
}

const PALETTES: Record<ThemeId, Palette> = {
  basement: {
    floor: '#2b2a24',
    floorDark: '#14130f',
    floorLight: '#4a453a',
    wall: '#3a352b',
    wallDark: '#17140f',
    wallLight: '#4c4638',
    ceiling: 0x14130f,
    lamp: 0xffb066,
    dust: 0xbfae8e,
    prop: 0x4b4238,
    planks: true,
  },
  mortuary: {
    floor: '#242a2a',
    floorDark: '#101615',
    floorLight: '#3f4a48',
    wall: '#38403f',
    wallDark: '#121817',
    wallLight: '#4b5451',
    ceiling: 0x101414,
    lamp: 0x8fc7d8,
    dust: 0xa9c4c8,
    prop: 0x4a5452,
    planks: false,
  },
  chapel: {
    floor: '#221c22',
    floorDark: '#0f0a10',
    floorLight: '#3b2f3d',
    wall: '#33283a',
    wallDark: '#100a13',
    wallLight: '#453650',
    ceiling: 0x0f0a12,
    lamp: 0xff8a5c,
    dust: 0xd0b6a0,
    prop: 0x3a2c3f,
    planks: true,
  },
  clocktower: {
    floor: '#22262b',
    floorDark: '#0d1013',
    floorLight: '#3a4148',
    wall: '#2f343b',
    wallDark: '#0e1114',
    wallLight: '#424a52',
    ceiling: 0x0a0d11,
    lamp: 0x9fb6d8,
    dust: 0xb9c6d8,
    prop: 0x3c434a,
    planks: false,
  },
};

interface LightNode {
  light: THREE.PointLight;
  cone?: THREE.Mesh;
  coneMaterial?: THREE.MeshBasicMaterial;
  base: number;
  phase: number;
}

interface ObjectiveView {
  group: THREE.Group;
  ring: THREE.Mesh;
  ringMaterial: THREE.MeshBasicMaterial;
  glow: THREE.Sprite;
  glowMaterial: THREE.SpriteMaterial;
  lamp?: THREE.MeshBasicMaterial;
}

export class World {
  readonly scene = new THREE.Scene();
  readonly flashlight: THREE.SpotLight;
  private camera: THREE.PerspectiveCamera;
  private levelGroup = new THREE.Group();
  private itemViews = new Map<string, THREE.Group>();
  private objectiveViews = new Map<string, ObjectiveView>();
  private trapViews = new Map<string, THREE.Group>();
  private hunterViews = new Map<HunterId, HunterView>();
  private lightNodes: LightNode[] = [];
  private dust?: THREE.Points;
  private rain?: THREE.Points;
  private rainVelocity: number[] = [];
  private lightning?: THREE.DirectionalLight;
  private lightningTimer = 6;
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private time = 0;
  private theme: ThemeId = 'basement';
  private session?: GameSession;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.scene.background = new THREE.Color(0x07090a);
    this.scene.add(this.levelGroup);

    const ambient = new THREE.AmbientLight(0x8fa2b5, 0.55);
    const hemi = new THREE.HemisphereLight(0x9fb0c4, 0x1a1512, 0.5);
    this.scene.add(ambient, hemi);

    this.flashlight = new THREE.SpotLight(0xffe3b8, 0, 34, 0.52, 0.7, 1.5);
    this.flashlight.position.set(0.22, -0.12, 0);
    this.flashlight.castShadow = false;
    this.flashlight.target.position.set(0, 0, -1);
    this.camera.add(this.flashlight);
    this.camera.add(this.flashlight.target);
    this.scene.add(this.camera);
  }

  build(session: GameSession): void {
    this.session = session;
    this.theme = session.level.theme;
    this.clearLevel();

    const palette = PALETTES[this.theme];
    const level = session.level;

    this.scene.background = new THREE.Color(level.fogColor);
    this.scene.fog = new THREE.FogExp2(level.fogColor, level.fogDensity);

    this.buildShell(session.map, palette);
    this.buildProps(session.map, palette);
    this.buildLights(session.map, palette);
    this.buildDust(session.map, palette);
    if (this.theme === 'clocktower') this.buildRain(session.map);

    for (const objective of session.layout.objectives) this.addObjective(objective);
    for (const item of session.worldItems) this.addItem(item);
    for (const trap of session.traps) this.ensureTrap(trap.id, trap.pos);
    for (const hunter of session.hunters.hunters) {
      const view = hunter.id === 'granny' ? createGrannyView() : createMundiyaView();
      this.hunterViews.set(hunter.id, view);
      this.levelGroup.add(view.group);
    }
  }

  setFlashlight(on: boolean): void {
    this.flashlight.intensity = on ? 30 : 0;
  }

  sync(session: GameSession, dt: number): void {
    this.time += dt;
    const flicker = 0.82 + Math.sin(this.time * 13.7) * 0.06 + Math.sin(this.time * 31.1) * 0.04;

    for (const node of this.lightNodes) {
      const wobble = 0.7 + 0.3 * Math.sin(this.time * (3 + node.phase) + node.phase * 7);
      node.light.intensity = node.base * wobble * flicker;
      if (node.coneMaterial) node.coneMaterial.opacity = 0.028 + 0.03 * wobble;
    }

    if (this.flashlight.intensity > 0) {
      const stutter = Math.sin(this.time * 27) > 0.96 ? 0.35 : 1;
      this.flashlight.intensity = 30 * stutter * (0.92 + Math.sin(this.time * 9.3) * 0.08);
    }

    // Objective fixtures
    for (const objective of session.layout.objectives) {
      const view = this.objectiveViews.get(objective.spec.id);
      if (!view) continue;
      const done = session.objectives[objective.spec.id] === 'done';
      view.ring.visible = !done;
      view.glow.visible = !done;
      view.group.userData.done = done;
      if (!done) {
        const pulse = 0.6 + Math.sin(this.time * 2.4 + objective.pos.x) * 0.4;
        view.ringMaterial.opacity = 0.3 + pulse * 0.45;
        view.ring.rotation.z += dt * 0.6;
        view.ring.position.y = 1.55 + Math.sin(this.time * 1.7) * 0.09;
        view.glowMaterial.opacity = 0.2 + pulse * 0.28;
      }
      if (view.lamp) view.lamp.opacity = done ? 0.15 : 0.65 + Math.sin(this.time * 6) * 0.25;
    }

    // Pickups
    for (const item of session.worldItems) {
      const view = this.itemViews.get(item.id);
      if (!view) continue;
      view.visible = !item.taken;
      if (item.taken) continue;
      view.position.set(item.pos.x, 0.55 + Math.sin(this.time * 2 + item.pos.x) * 0.07, item.pos.y);
      view.rotation.y += dt * 0.9;
    }

    // Traps
    for (const trap of session.traps) {
      const view = this.ensureTrap(trap.id, trap.pos);
      view.visible = true;
      view.rotation.y += dt * 0.15;
      const jaw = view.userData.jaw as THREE.Object3D | undefined;
      if (jaw) jaw.rotation.x = trap.armed ? 0.5 : -0.9;
    }

    // Hunters
    for (const hunter of session.hunters.hunters) {
      this.hunterViews.get(hunter.id)?.update(dt, hunter);
    }

    if (this.dust) {
      const positions = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i += 1) {
        const y = positions.getY(i) + dt * 0.12;
        positions.setY(i, y > WALL_HEIGHT ? 0.15 : y);
        positions.setX(i, positions.getX(i) + Math.sin(this.time * 0.4 + i) * dt * 0.06);
      }
      positions.needsUpdate = true;
    }

    if (this.rain) {
      const positions = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < positions.count; i += 1) {
        let y = positions.getY(i) - dt * (14 + this.rainVelocity[i]);
        if (y < 0.2) y = 14 + Math.random() * 4;
        positions.setY(i, y);
      }
      positions.needsUpdate = true;
    }

    if (this.lightning) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 9 + Math.random() * 14;
        this.lightning.intensity = 26;
      }
      this.lightning.intensity = Math.max(0, this.lightning.intensity - dt * 60);
    }
  }

  dispose(): void {
    this.clearLevel();
    for (const view of this.hunterViews.values()) view.dispose();
    this.hunterViews.clear();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
  }

  // ------------------------------------------------------------------ shell

  private buildShell(map: GameMap, palette: Palette): void {
    const floorTexture = grungeTexture({
      base: palette.floor,
      dark: palette.floorDark,
      light: palette.floorLight,
      planks: palette.planks,
      seed: map.seed + 1,
      repeat: [MAP_W, MAP_H],
      blobs: 180,
    });
    const floorMaterial = new THREE.MeshStandardMaterial({
      map: floorTexture,
      roughness: 0.94,
      metalness: 0.06,
      color: 0xcfc8bd,
    });
    this.disposables.push(floorTexture, floorMaterial);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W * CELL, MAP_H * CELL), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((MAP_W * CELL) / 2, 0, (MAP_H * CELL) / 2);
    this.levelGroup.add(floor);

    const ceilingMaterial = new THREE.MeshStandardMaterial({ color: palette.ceiling, roughness: 1 });
    this.disposables.push(ceilingMaterial);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W * CELL, MAP_H * CELL), ceilingMaterial);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set((MAP_W * CELL) / 2, WALL_HEIGHT, (MAP_H * CELL) / 2);
    this.levelGroup.add(ceiling);

    const wallTexture = grungeTexture({
      base: palette.wall,
      dark: palette.wallDark,
      light: palette.wallLight,
      bricks: this.theme !== 'chapel',
      seed: map.seed + 2,
      blobs: 200,
    });
    const wallMaterial = new THREE.MeshStandardMaterial({
      map: wallTexture,
      roughness: 0.97,
      metalness: 0.04,
      color: 0xd2cbc0,
    });
    this.disposables.push(wallTexture, wallMaterial);

    const wallCells: [number, number][] = [];
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        if (map.walls[y * map.width + x] === 1) wallCells.push([x, y]);
      }
    }

    const wallGeometry = new THREE.BoxGeometry(CELL, WALL_HEIGHT, CELL);
    this.disposables.push(wallGeometry);
    const walls = new THREE.InstancedMesh(wallGeometry, wallMaterial, wallCells.length);
    const matrix = new THREE.Matrix4();
    wallCells.forEach(([x, y], i) => {
      matrix.makeTranslation((x + 0.5) * CELL, WALL_HEIGHT / 2, (y + 0.5) * CELL);
      walls.setMatrixAt(i, matrix);
    });
    walls.instanceMatrix.needsUpdate = true;
    walls.frustumCulled = false;
    this.levelGroup.add(walls);

    // Skirting boards and dado rails break up the flat wall faces.
    const trimMaterial = new THREE.MeshStandardMaterial({ color: palette.prop, roughness: 0.9 });
    this.disposables.push(trimMaterial);
    const trimGeometry = new THREE.BoxGeometry(CELL, 0.16, CELL * 1.02);
    this.disposables.push(trimGeometry);
    for (const [x, y] of wallCells) {
      if (y % 2 !== 0) continue;
      const trim = new THREE.Mesh(trimGeometry, trimMaterial);
      trim.position.set((x + 0.5) * CELL, 0.1, (y + 0.5) * CELL);
      this.levelGroup.add(trim);
    }

    if (this.theme === 'chapel') {
      const graffiti = graffitiTexture(map.seed + 5);
      this.disposables.push(graffiti);
      const graffitiMaterial = new THREE.MeshBasicMaterial({
        map: graffiti,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      });
      this.disposables.push(graffitiMaterial);
      const plane = new THREE.PlaneGeometry(4.2, 4.2);
      this.disposables.push(plane);
      const anchor = map.rooms[Math.min(2, map.rooms.length - 1)];
      const sigil = new THREE.Mesh(plane, graffitiMaterial);
      sigil.position.set(anchor.cx * CELL + CELL / 2, 2.1, anchor.cy * CELL + CELL / 2);
      sigil.rotation.y = Math.PI / 4;
      this.levelGroup.add(sigil);
    }
  }

  // ------------------------------------------------------------------ props

  private buildProps(map: GameMap, palette: Palette): void {
    const rng = mulberry32(map.seed + 77);
    const material = new THREE.MeshStandardMaterial({ color: palette.prop, roughness: 0.88, metalness: 0.25 });
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x1d1a17, roughness: 1 });
    const rustMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.9, metalness: 0.3 });
    this.disposables.push(material, darkMaterial, rustMaterial);

    const add = (mesh: THREE.Mesh, x: number, z: number, ry = 0) => {
      mesh.position.set(x * CELL + CELL / 2, mesh.position.y, z * CELL + CELL / 2);
      mesh.rotation.y = ry;
      this.levelGroup.add(mesh);
    };

    for (const room of map.rooms) {
      if (room.id === 0) continue;
      const kind = Math.floor(rng() * 4);
      const rx = room.x + 1 + Math.floor(rng() * Math.max(1, room.w - 2));
      const rz = room.y + 1 + Math.floor(rng() * Math.max(1, room.h - 2));

      if (this.theme === 'basement') {
        if (kind === 0) {
          // Rusted cage.
          const size = 1.5;
          const barGeometry = new THREE.BoxGeometry(0.06, 1.9, 0.06);
          this.disposables.push(barGeometry);
          for (const [ox, oz] of [
            [-0.6, -0.6],
            [0.6, -0.6],
            [-0.6, 0.6],
            [0.6, 0.6],
          ]) {
            const bar = new THREE.Mesh(barGeometry, rustMaterial);
            bar.position.set(ox, 0.95, oz);
            add(bar, rx, rz);
          }
          const top = new THREE.Mesh(new THREE.BoxGeometry(size, 0.08, size), rustMaterial);
          this.disposables.push(top.geometry);
          top.position.y = 1.9;
          add(top, rx, rz);
        } else if (kind === 1) {
          const frame = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.95), rustMaterial);
          this.disposables.push(frame.geometry);
          frame.position.y = 0.62;
          add(frame, rx, rz, rng() * Math.PI);
          const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 0.8), darkMaterial);
          this.disposables.push(mattress.geometry);
          mattress.position.y = 0.78;
          add(mattress, rx, rz, frame.rotation.y);
        } else if (kind === 2) {
          const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12), rustMaterial);
          this.disposables.push(barrel.geometry);
          barrel.position.y = 0.52;
          add(barrel, rx, rz);
        } else {
          const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3.4, 8), rustMaterial);
          this.disposables.push(pipe.geometry);
          pipe.rotation.z = Math.PI / 2;
          pipe.position.y = 2.6;
          add(pipe, rx, rz, rng() * Math.PI);
        }
      } else if (this.theme === 'mortuary') {
        if (kind === 0) {
          // Mortuary drawer bank.
          const bank = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.7, 0.9), material);
          this.disposables.push(bank.geometry);
          bank.position.y = 0.85;
          add(bank, rx, rz, rng() > 0.5 ? 0 : Math.PI / 2);
          for (let i = 0; i < 3; i += 1) {
            const drawer = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.45, 0.06), darkMaterial);
            this.disposables.push(drawer.geometry);
            drawer.position.set(0, 0.35 + i * 0.55, 0.48);
            bank.add(drawer);
          }
        } else if (kind === 1) {
          const table = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.8), material);
          this.disposables.push(table.geometry);
          table.position.y = 0.85;
          add(table, rx, rz, rng() * Math.PI);
          const sheet = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.22, 0.6), new THREE.MeshStandardMaterial({ color: 0x9a9c92, roughness: 1 }));
          this.disposables.push(sheet.geometry, sheet.material);
          sheet.position.set(0, 0.12, 0);
          table.add(sheet);
        } else if (kind === 2) {
          const trolley = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.7), material);
          this.disposables.push(trolley.geometry);
          trolley.position.y = 0.7;
          add(trolley, rx, rz, rng() * Math.PI);
        } else {
          const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.5), material);
          this.disposables.push(cabinet.geometry);
          cabinet.position.y = 0.8;
          add(cabinet, rx, rz, rng() * Math.PI);
        }
      } else if (this.theme === 'chapel') {
        if (kind <= 1) {
          // Pews.
          const pew = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.5), material);
          this.disposables.push(pew.geometry);
          pew.position.y = 0.5;
          add(pew, rx, rz, Math.PI / 2);
          const back = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 0.1), material);
          this.disposables.push(back.geometry);
          back.position.set(0, 0.35, -0.24);
          pew.add(back);
        } else if (kind === 2) {
          // Hanging cage.
          const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6), rustMaterial);
          this.disposables.push(chain.geometry);
          chain.position.y = WALL_HEIGHT - 0.7;
          add(chain, rx, rz);
          const cage = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.9), new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 1, wireframe: true }));
          this.disposables.push(cage.geometry, cage.material);
          cage.position.y = WALL_HEIGHT - 1.9;
          add(cage, rx, rz);
        } else {
          const altar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.9), material);
          this.disposables.push(altar.geometry);
          altar.position.y = 0.45;
          add(altar, rx, rz);
          const candles = new THREE.Mesh(
            new THREE.CylinderGeometry(0.06, 0.06, 0.3, 6),
            new THREE.MeshBasicMaterial({ color: 0xffcf8a }),
          );
          this.disposables.push(candles.geometry, candles.material);
          candles.position.set(0, 0.62, 0);
          altar.add(candles);
        }
      } else {
        if (kind === 0) {
          const gear = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.18, 16), rustMaterial);
          this.disposables.push(gear.geometry);
          gear.rotation.x = Math.PI / 2;
          gear.position.y = 1.2;
          add(gear, rx, rz);
        } else if (kind === 1) {
          const beam = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.22, 0.22), material);
          this.disposables.push(beam.geometry);
          beam.position.y = 2.4;
          add(beam, rx, rz, rng() * Math.PI);
        } else if (kind === 2) {
          const crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), material);
          this.disposables.push(crate.geometry);
          crate.position.y = 0.45;
          add(crate, rx, rz, rng() * Math.PI);
        } else {
          const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 8), rustMaterial);
          this.disposables.push(pipe.geometry);
          pipe.position.y = 2.8;
          add(pipe, rx, rz);
        }
      }
    }
  }

  // ----------------------------------------------------------------- lights

  private buildLights(map: GameMap, palette: Palette): void {
    const rooms = map.rooms.slice(0, 10);
    rooms.forEach((room, index) => {
      const base = this.theme === 'mortuary' ? 10 : this.theme === 'chapel' ? 7 : 8.5;
      const light = new THREE.PointLight(palette.lamp, base, 20, 2);
      light.position.set(room.cx * CELL + CELL / 2, WALL_HEIGHT - 0.7, room.cy * CELL + CELL / 2);
      this.levelGroup.add(light);

      const coneGeometry = new THREE.ConeGeometry(2.4, WALL_HEIGHT - 0.9, 16, 1, true);
      this.disposables.push(coneGeometry);
      const coneMaterial = new THREE.MeshBasicMaterial({
        color: palette.lamp,
        transparent: true,
        opacity: 0.04,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.disposables.push(coneMaterial);
      const cone = new THREE.Mesh(coneGeometry, coneMaterial);
      cone.position.copy(light.position);
      cone.position.y = (WALL_HEIGHT - 0.9) / 2;
      this.levelGroup.add(cone);

      this.lightNodes.push({ light, cone, coneMaterial, base, phase: index * 1.37 });
    });

    if (this.theme === 'clocktower') {
      const lightning = new THREE.DirectionalLight(0xcfe0ff, 0);
      lightning.position.set(30, 40, 20);
      this.lightning = lightning;
      this.levelGroup.add(lightning);
    }
  }

  private buildDust(map: GameMap, palette: Palette): void {
    const count = 1100;
    const positions = new Float32Array(count * 3);
    const rng = mulberry32(map.seed + 31);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = rng() * MAP_W * CELL;
      positions[i * 3 + 1] = rng() * WALL_HEIGHT;
      positions[i * 3 + 2] = rng() * MAP_H * CELL;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: palette.dust,
      size: 0.055,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.disposables.push(geometry, material);
    this.dust = new THREE.Points(geometry, material);
    this.levelGroup.add(this.dust);
  }

  private buildRain(map: GameMap): void {
    const count = 1600;
    const positions = new Float32Array(count * 3);
    this.rainVelocity = [];
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = Math.random() * MAP_W * CELL;
      positions[i * 3 + 1] = Math.random() * 16;
      positions[i * 3 + 2] = Math.random() * MAP_H * CELL;
      this.rainVelocity.push(Math.random() * 10);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xbcd2e8,
      size: 0.08,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.disposables.push(geometry, material);
    this.rain = new THREE.Points(geometry, material);
    this.levelGroup.add(this.rain);
  }

  // ------------------------------------------------------------- objectives

  private addObjective(objective: PlacedObjective): void {
    const group = new THREE.Group();
    group.position.set(objective.pos.x, 0, objective.pos.y);

    const fixture = new THREE.Group();
    const lampMaterial = new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0.7 });
    this.disposables.push(lampMaterial);

    const meshMaterial = new THREE.MeshStandardMaterial({ color: 0x4a4238, roughness: 0.85, metalness: 0.35 });
    this.disposables.push(meshMaterial);

    const id = objective.spec.id;
    const addBox = (w: number, h: number, d: number, y: number, material: THREE.Material = meshMaterial, x = 0, z = 0) => {
      const geometry = new THREE.BoxGeometry(w, h, d);
      this.disposables.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      fixture.add(mesh);
      return mesh;
    };

    if (id === 'shockWire') {
      const postGeometry = new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8);
      this.disposables.push(postGeometry);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(postGeometry, meshMaterial);
        post.position.set(side * 1.3, 1.2, 0);
        fixture.add(post);
      }
      addBox(2.6, 0.03, 0.03, 2.1, lampMaterial);
      addBox(2.6, 0.03, 0.03, 1.4, lampMaterial);
      addBox(2.6, 0.03, 0.03, 0.7, lampMaterial);
    } else if (id === 'ironDoor' || id === 'elevator' || id === 'perimeterGate') {
      addBox(3.0, 3.2, 0.4, 1.6, meshMaterial);
      addBox(3.4, 0.24, 0.5, 3.3, meshMaterial);
      const barGeometry = new THREE.CylinderGeometry(0.05, 0.05, 2.8, 6);
      this.disposables.push(barGeometry);
      for (let i = -2; i <= 2; i += 1) {
        const bar = new THREE.Mesh(barGeometry, id === 'perimeterGate' ? meshMaterial : lampMaterial);
        bar.position.set(i * 0.55, 1.6, 0.26);
        fixture.add(bar);
      }
      if (id === 'elevator') {
        const panel = addBox(0.5, 0.8, 0.12, 1.5, meshMaterial, 2.1, 0.1);
        panel.position.x = 2.1;
      }
    } else if (id === 'fusePanel') {
      addBox(1.5, 1.9, 0.35, 1.5, meshMaterial);
      const colors = [0xd63b3b, 0x3bd66a, 0x3b7ad6];
      colors.forEach((color, i) => {
        const socketMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
        this.disposables.push(socketMaterial);
        const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.2, 10), socketMaterial);
        this.disposables.push(socket.geometry);
        socket.rotation.x = Math.PI / 2;
        socket.position.set(-0.45 + i * 0.45, 1.7, 0.22);
        fixture.add(socket);
      });
    } else if (id === 'vent') {
      addBox(1.6, 1.1, 0.18, 1.3, meshMaterial);
      for (let i = 0; i < 5; i += 1) addBox(1.4, 0.07, 0.1, 0.95 + i * 0.18, lampMaterial, 0, 0.12);
    } else if (id === 'roofStairs') {
      for (let i = 0; i < 6; i += 1) addBox(2.0, 0.18, 0.6, 0.12 + i * 0.2, meshMaterial, 0, -i * 0.55);
      addBox(2.6, 2.6, 0.2, 2.2, meshMaterial, 0, -3.4);
    } else if (id === 'clockGears') {
      const gearGeometry = new THREE.CylinderGeometry(0.85, 0.85, 0.16, 18);
      this.disposables.push(gearGeometry);
      for (let i = 0; i < 3; i += 1) {
        const gear = new THREE.Mesh(gearGeometry, meshMaterial);
        gear.rotation.x = Math.PI / 2;
        gear.position.set(-1 + i * 0.9, 1.2 + (i % 2) * 0.5, 0);
        fixture.add(gear);
      }
      addBox(0.3, 3.0, 0.3, 1.5, meshMaterial);
    } else if (id === 'clockFace') {
      const face = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 24), meshMaterial);
      this.disposables.push(face.geometry);
      face.rotation.x = Math.PI / 2;
      face.position.y = 1.7;
      fixture.add(face);
      addBox(0.08, 1.1, 0.06, 1.9, lampMaterial, 0, 0.18);
      addBox(0.7, 0.08, 0.06, 2.1, lampMaterial, 0.3, 0.18);
    } else if (id.startsWith('slot')) {
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 1.0, 12), meshMaterial);
      this.disposables.push(pedestal.geometry);
      pedestal.position.y = 0.5;
      fixture.add(pedestal);
      const slotColor = id === 'slotAsh' ? 0xb9b4ac : id === 'slotBone' ? 0xe4dcc4 : id === 'slotSalt' ? 0xd9d3e6 : 0x8a7f72;
      const slotMaterial = new THREE.MeshBasicMaterial({ color: slotColor, transparent: true, opacity: 0.7 });
      this.disposables.push(slotMaterial);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 8, 20), slotMaterial);
      this.disposables.push(ring.geometry);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 1.06;
      fixture.add(ring);
    } else {
      addBox(1.1, 1.0, 1.1, 0.5, meshMaterial);
    }

    group.add(fixture);

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffcf94,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.disposables.push(ringMaterial);
    const ringGeometry = new THREE.TorusGeometry(0.55, 0.035, 8, 28);
    this.disposables.push(ringGeometry);
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.55;
    group.add(ring);

    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture('rgba(255,206,150,1)', 'rgba(255,140,60,0)'),
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(glowMaterial);
    const glow = new THREE.Sprite(glowMaterial);
    glow.scale.set(2.2, 2.2, 1);
    glow.position.y = 1.6;
    group.add(glow);

    this.levelGroup.add(group);
    this.objectiveViews.set(id, { group, ring, ringMaterial, glow, glowMaterial, lamp: lampMaterial });
  }

  private addItem(item: WorldItem): void {
    const def = ITEMS[item.item];
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: def.color,
      emissive: new THREE.Color(def.color).multiplyScalar(0.35),
      roughness: 0.5,
      metalness: 0.6,
    });
    this.disposables.push(material);

    let geometry: THREE.BufferGeometry;
    if (def.kind === 'key') geometry = new THREE.TorusGeometry(0.12, 0.035, 8, 18);
    else if (def.kind === 'fuse') geometry = new THREE.CylinderGeometry(0.07, 0.07, 0.34, 10);
    else if (def.kind === 'relic') geometry = new THREE.IcosahedronGeometry(0.16, 0);
    else if (def.kind === 'trap') geometry = new THREE.TorusGeometry(0.2, 0.04, 6, 14);
    else geometry = new THREE.BoxGeometry(0.12, 0.34, 0.12);
    this.disposables.push(geometry);

    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);

    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture('rgba(255,240,205,1)', 'rgba(255,170,80,0)'),
      color: def.color,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(glowMaterial);
    const glow = new THREE.Sprite(glowMaterial);
    glow.scale.set(1.1, 1.1, 1);
    group.add(glow);

    group.position.set(item.pos.x, 0.55, item.pos.y);
    this.levelGroup.add(group);
    this.itemViews.set(item.id, group);
  }

  private ensureTrap(id: string, pos: { x: number; y: number }): THREE.Group {
    const existing = this.trapViews.get(id);
    if (existing) return existing;

    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0x7a5a3c, roughness: 0.85, metalness: 0.5 });
    this.disposables.push(material);
    const baseGeometry = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 12);
    this.disposables.push(baseGeometry);
    const base = new THREE.Mesh(baseGeometry, material);
    group.add(base);

    const jaw = new THREE.Group();
    const toothGeometry = new THREE.ConeGeometry(0.05, 0.3, 6);
    this.disposables.push(toothGeometry);
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const tooth = new THREE.Mesh(toothGeometry, material);
      tooth.position.set(Math.cos(angle) * 0.32, 0.16, Math.sin(angle) * 0.32);
      tooth.rotation.z = Math.cos(angle) * 0.5;
      tooth.rotation.x = Math.sin(angle) * 0.5;
      jaw.add(tooth);
    }
    jaw.rotation.x = 0.5;
    group.add(jaw);
    group.userData.jaw = jaw;

    group.position.set(pos.x, 0.06, pos.y);
    this.levelGroup.add(group);
    this.trapViews.set(id, group);
    return group;
  }

  private clearLevel(): void {
    for (const view of this.hunterViews.values()) view.dispose();
    this.hunterViews.clear();
    this.scene.remove(this.levelGroup);
    this.levelGroup.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else if (material) material.dispose();
    });
    this.levelGroup.clear();
    this.levelGroup = new THREE.Group();
    this.scene.add(this.levelGroup);

    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
    this.itemViews.clear();
    this.objectiveViews.clear();
    this.trapViews.clear();
    this.lightNodes = [];
    this.dust = undefined;
    this.rain = undefined;
    this.lightning = undefined;
  }
}

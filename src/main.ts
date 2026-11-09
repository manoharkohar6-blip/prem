import * as THREE from 'three';
import './style.css';
import { HorrorAudio } from './audio/audio';
import { ITEMS } from './game/items';
import { MAX_DAYS } from './game/levels';
import { GameSession, INTERACT_RANGE, PICKUP_RANGE } from './game/session';
import type { HunterId, Vec2 } from './game/types';
import { clamp, distance } from './game/vec';
import { HorrorPost } from './render/horror';
import { World } from './render/world';
import { Hud } from './ui/hud';

const EYE_HEIGHT = 1.62;
const CROUCH_EYE = 1.05;
const LOOK_SENSITIVITY = 0.0023;
const BASE_FOV = 74;
const CAUGHT_SECONDS = 2.8;

type Phase = 'menu' | 'briefing' | 'playing' | 'paused' | 'caught' | 'ended';

class AsylumGame {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly session: GameSession;
  private readonly world: World;
  private readonly post: HorrorPost;
  private readonly audio = new HorrorAudio();
  private readonly hud = new Hud();
  private readonly clock = new THREE.Clock();

  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private strafe = 0;
  private bob = 0;
  private eye = EYE_HEIGHT;
  private fov = BASE_FOV;
  private fade = 1;
  private fadeTarget = 1;
  private flash = 0;
  private threat = 0;
  private threatTarget = 0;
  private distortion = 0;
  private phase: Phase = 'menu';
  private caughtTimer = 0;
  private lostOnCatch = false;
  private prompt: string | null = null;
  private pointerLocked = false;
  private everLocked = false;
  private time = 0;
  private lastRender = 0;
  private ready = false;
  private startButton: HTMLButtonElement | null = null;
  private startLabel = 'Enter the asylum';

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.08, 240);
    this.camera.rotation.order = 'YXZ';

    this.session = new GameSession(Math.floor(Math.random() * 0xffffff));
    this.world = new World(this.camera);
    this.world.build(this.session);
    this.world.setFlashlight(false);

    this.post = new HorrorPost(this.renderer, window.innerWidth, window.innerHeight);
    this.audio.setTheme(this.session.level.theme);

    this.bindEvents();
    this.setPhase('menu');
    this.hud.setVisible(false);
    this.hud.showPanel('start');

    (window as unknown as Record<string, unknown>).__asylum = {
      session: this.session,
      game: this,
    };

    this.prepareStartButton();
    this.loop();
  }

  // ------------------------------------------------------------------ phases

  private setPhase(phase: Phase): void {
    this.phase = phase;
    document.body.dataset.phase = phase;
    document.body.dataset.level = String(this.session.levelIndex + 1);
  }

  private async start(): Promise<void> {
    await this.audio.unlock();
    this.audio.setTheme(this.session.level.theme);
    this.hud.setVisible(true);
    this.hud.setBriefing(this.session);
    this.hud.showPanel('briefing');
    this.setPhase('briefing');
    this.exitLock();
  }

  private beginLevel(): void {
    this.hud.showPanel(null);
    this.hud.clearToasts();
    this.setPhase('playing');
    this.fade = 1;
    this.fadeTarget = 0;
    this.requestLock();
    this.audio.footstep(0.2);
  }

  private pause(): void {
    if (this.phase !== 'playing') return;
    this.setPhase('paused');
    this.hud.showPanel('pause');
    this.exitLock();
  }

  private resume(): void {
    if (this.phase !== 'paused') return;
    this.hud.showPanel(null);
    this.setPhase('playing');
    this.requestLock();
  }

  private endRun(won: boolean): void {
    this.setPhase('ended');
    this.hud.setEnd(won, this.session);
    this.hud.showPanel('end');
    this.hud.setVisible(false);
    this.exitLock();
    if (won) this.audio.objective();
    else this.audio.stinger();
  }

  private restart(): void {
    this.session.restart();
    this.world.build(this.session);
    this.world.setFlashlight(false);
    this.audio.setTheme(this.session.level.theme);
    this.hud.clearToasts();
    this.hud.setVisible(true);
    this.hud.setBriefing(this.session);
    this.hud.showPanel('briefing');
    this.setPhase('briefing');
    this.yaw = 0;
    this.pitch = 0;
    this.threat = 0;
    this.threatTarget = 0;
    this.fade = 1;
    this.fadeTarget = 1;
  }

  private resumeAfterCatch(): void {
    if (this.lostOnCatch) {
      this.endRun(false);
      return;
    }
    this.hud.showPanel(null);
    this.setPhase('playing');
    this.fade = 0.75;
    this.fadeTarget = 0;
    this.requestLock();
  }

  // ------------------------------------------------------------------- input

  private bindEvents(): void {
    window.addEventListener('resize', () => this.onResize());

    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.renderer.domElement;
      if (this.pointerLocked) this.everLocked = true;
      else if (this.phase === 'playing' && this.everLocked) this.pause();
    });

    document.addEventListener('pointerlockerror', () => {
      this.pointerLocked = false;
    });

    document.addEventListener('mousemove', (event) => {
      if (!this.pointerLocked || this.phase !== 'playing') return;
      this.yaw -= event.movementX * LOOK_SENSITIVITY;
      this.pitch = clamp(this.pitch - event.movementY * LOOK_SENSITIVITY, -1.32, 1.32);
    });

    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());

    this.renderer.domElement.addEventListener('mousedown', () => {
      if (this.phase === 'playing' && !this.pointerLocked) this.requestLock();
    });

    document.getElementById('btn-start')?.addEventListener('click', () => void this.start());
    document.getElementById('btn-begin')?.addEventListener('click', () => this.beginLevel());
    document.getElementById('btn-restart')?.addEventListener('click', () => this.restart());
    document.getElementById('btn-resume')?.addEventListener('click', () => this.resume());
  }

  private onKeyDown(event: KeyboardEvent): void {
    const code = event.code;
    if (code === 'Escape') {
      if (this.phase === 'playing') this.pause();
      else if (this.phase === 'paused') this.resume();
      return;
    }

    if (this.phase !== 'playing') {
      if (code === 'Enter' || code === 'Space') {
        event.preventDefault();
        if (this.phase === 'menu') void this.start();
        else if (this.phase === 'briefing') this.beginLevel();
        else if (this.phase === 'paused') this.resume();
        else if (this.phase === 'ended') this.restart();
      }
      return;
    }

    this.keys.add(code);

    switch (code) {
      case 'KeyE':
        this.session.interact();
        break;
      case 'KeyF':
        this.session.toggleLight();
        break;
      case 'KeyT':
        this.session.placeTrap();
        break;
      case 'KeyM': {
        const muted = !this.audio.isMuted;
        this.audio.setMuted(muted);
        this.hud.toast(muted ? 'Audio muted.' : 'Audio on.', 'info');
        break;
      }
      case 'KeyH':
        this.hud.toggleHelp();
        break;
      case 'Digit1':
        this.session.dropItem(0);
        break;
      case 'Digit2':
        this.session.dropItem(1);
        break;
      case 'Digit3':
        this.session.dropItem(2);
        break;
      default:
        break;
    }

    if (code === 'Space' || code.startsWith('Arrow')) event.preventDefault();
  }

  private requestLock(): void {
    const canvas = this.renderer.domElement;
    if (document.pointerLockElement === canvas) return;
    try {
      const result = canvas.requestPointerLock() as unknown;
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => undefined);
      }
    } catch {
      // Pointer lock is optional: keyboard control still works.
    }
  }

  private exitLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    this.pointerLocked = false;
  }

  private onResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.post.setSize(width, height);
  }

  // ------------------------------------------------------------------ update

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    this.update(dt);
    // With a full-screen panel up the scene is mostly hidden, so cap the frame
    // rate. It keeps menus responsive on weak or software-rendered GPUs.
    if (this.phase !== 'playing' && this.phase !== 'caught') {
      const now = performance.now();
      if (this.ready && now - this.lastRender < 60) return;
      this.lastRender = now;
    }
    this.render(dt);
    this.enableStart();
  };

  /**
   * The start button stays inert until the first frame is actually on screen, so
   * a click can never land while shaders and procedural textures are compiling.
   */
  private prepareStartButton(): void {
    const button = document.getElementById('btn-start') as HTMLButtonElement | null;
    this.startButton = button;
    if (!button) {
      this.ready = true;
      return;
    }
    this.startLabel = button.textContent?.trim() || this.startLabel;
    button.disabled = true;
    button.textContent = 'Preparing the asylum…';
    // Fallback for tabs where the first animation frame never arrives.
    window.setTimeout(() => this.enableStart(), 4000);
  }

  private enableStart(): void {
    if (this.ready) return;
    this.ready = true;
    const button = this.startButton;
    if (!button) return;
    button.disabled = false;
    button.textContent = this.startLabel;
  }

  private update(dt: number): void {
    if (this.phase === 'playing') this.updatePlaying(dt);
    else if (this.phase === 'caught') this.updateCaught(dt);
    else if (this.phase === 'menu') this.yaw += dt * 0.045;

    this.fade += (this.fadeTarget - this.fade) * Math.min(1, dt * 2.4);
    this.flash = Math.max(0, this.flash - dt * 1.4);
    this.threat += (this.threatTarget - this.threat) * Math.min(1, dt * 2.6);

    this.distortion = this.computeDistortion();
    this.updateCamera(dt);

    if (this.phase === 'playing' || this.phase === 'caught' || this.phase === 'paused') {
      this.audio.update(dt, this.threat, this.session.nearestHunterDistance);
    }

    this.world.sync(this.session, dt, this.distortion * 0.85 + this.threat * 0.25);
    this.world.setFlashlight(this.session.player.hasFlashlight && this.session.player.lightOn);
    this.hud.update(this.session, this.prompt, this.threat);
  }

  private updatePlaying(dt: number): void {
    const crouch = this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('KeyC');
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    const forward = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) -
      Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const side = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) -
      Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    this.strafe = side;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const direction: Vec2 = {
      x: -sin * forward + cos * side,
      y: -cos * forward - sin * side,
    };

    this.session.player.yaw = this.yaw;
    this.session.movePlayer(direction, dt, { sprint, crouch });
    this.session.update(dt);
    this.handleEvents();
    this.prompt = this.findPrompt();

    if (this.phase === 'playing' && this.session.status === 'won') this.endRun(true);
    else if (this.phase === 'playing' && this.session.status === 'lost') this.endRun(false);
  }

  private updateCaught(dt: number): void {
    this.caughtTimer -= dt;
    if (this.caughtTimer <= 0) this.resumeAfterCatch();
  }

  private handleEvents(): void {
    for (const event of this.session.drainEvents()) {
      switch (event.type) {
        case 'pickup':
          this.hud.toast(`Took ${ITEMS[event.item].name}.`, 'good');
          this.audio.pickup();
          break;
        case 'granted':
          this.hud.toast(`Received ${ITEMS[event.item].name}.`, 'good');
          this.audio.pickup();
          break;
        case 'objective':
          this.hud.toast(`${event.label} — done.`, 'good');
          this.audio.objective();
          break;
        case 'blocked':
          this.hud.toast(event.message, 'warn');
          break;
        case 'message':
          this.hud.toast(event.message, 'info');
          break;
        case 'footstep':
          this.audio.footstep(event.intensity);
          break;
        case 'creak':
          this.hud.toast('The floorboard shrieks under you.', 'warn');
          this.audio.creak();
          break;
        case 'bell':
          this.hud.toast('The chapel bells scream. Something heard that.', 'bad');
          this.audio.bell();
          break;
        case 'trap':
          this.hud.toast('A bear trap snaps shut — Granny is down.', 'good');
          this.audio.trap();
          break;
        case 'threat':
          this.threatTarget = event.intensity;
          break;
        case 'caught':
          this.onCaught(event.hunter, event.day);
          break;
        case 'level':
          this.onLevelChange();
          break;
        case 'won':
          this.endRun(true);
          break;
        case 'lost':
          if (this.phase !== 'caught') this.endRun(false);
          break;
        default:
          break;
      }
    }
  }

  private onCaught(hunter: HunterId, day: number): void {
    this.lostOnCatch = this.session.status === 'lost';
    this.caughtTimer = CAUGHT_SECONDS;
    this.flash = 1;
    this.threatTarget = 1;
    this.hud.setCaught(hunter, day, this.lostOnCatch);
    this.hud.showPanel('caught');
    this.setPhase('caught');
    this.audio.stinger();

    if (!this.lostOnCatch) {
      this.world.build(this.session);
      this.world.setFlashlight(this.session.player.hasFlashlight && this.session.player.lightOn);
    }
  }

  private onLevelChange(): void {
    this.world.build(this.session);
    this.world.setFlashlight(this.session.player.hasFlashlight && this.session.player.lightOn);
    this.audio.setTheme(this.session.level.theme);
    this.hud.setBriefing(this.session);
    this.hud.showPanel('briefing');
    this.setPhase('briefing');
    this.exitLock();
    this.yaw = 0;
    this.pitch = 0;
    this.prompt = null;
    this.fade = 1;
    this.fadeTarget = 1;
  }

  private computeDistortion(): number {
    const mundiya = this.session.hunters.get('mundiya');
    if (!mundiya) return 0;
    const range = distance(mundiya.pos, this.session.player.pos);
    const near = clamp(1 - range / 15, 0, 1);
    const base = near * near * (mundiya.state === 'chase' ? 1 : 0.6);
    return clamp(base + this.threat * 0.25, 0, 1);
  }

  private updateCamera(dt: number): void {
    const player = this.session.player;
    const targetEye = player.crouching ? CROUCH_EYE : EYE_HEIGHT;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 8);

    const moving = player.moving;
    const pace = player.sprinting ? 12.5 : player.crouching ? 4.5 : 7.5;
    this.bob += dt * (moving ? pace : 1.4);
    const bobAmount = moving ? (player.sprinting ? 0.055 : 0.03) : 0.006;

    const shake = this.threat * 0.014 + this.distortion * 0.012;
    const swayX = Math.sin(this.bob * 0.5) * bobAmount * 0.6 + (Math.random() - 0.5) * shake;
    const swayY = Math.abs(Math.sin(this.bob)) * bobAmount + (Math.random() - 0.5) * shake;

    this.camera.position.set(player.pos.x + swayX, this.eye + swayY, player.pos.y);
    this.camera.rotation.set(
      this.pitch + (Math.random() - 0.5) * shake * 0.35,
      this.yaw,
      this.strafe * -0.018 + Math.sin(this.bob * 0.5) * 0.006,
    );

    const targetFov = BASE_FOV + (player.sprinting && moving ? 6 : 0);
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 4);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private findPrompt(): string | null {
    const player = this.session.player.pos;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const forward = { x: -sin, y: -cos };

    let bestText: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const item of this.session.worldItems) {
      if (item.taken) continue;
      const d = distance(item.pos, player);
      if (d > PICKUP_RANGE) continue;
      if (!this.inFront(player, item.pos, forward, d, 0.05)) continue;
      if (d < bestScore) {
        bestScore = d;
        bestText = `Take ${ITEMS[item.item].name}`;
      }
    }

    for (const objective of this.session.layout.objectives) {
      if (this.session.objectives[objective.spec.id] === 'done') continue;
      const d = distance(objective.pos, player);
      if (d > INTERACT_RANGE) continue;
      if (!this.inFront(player, objective.pos, forward, d, -0.15)) continue;
      if (d - 0.4 < bestScore) {
        bestScore = d - 0.4;
        bestText = objective.spec.label;
      }
    }

    return bestText;
  }

  private inFront(from: Vec2, target: Vec2, forward: Vec2, range: number, threshold: number): boolean {
    if (range < 1e-3) return true;
    const dot = ((target.x - from.x) / range) * forward.x + ((target.y - from.y) / range) * forward.y;
    return dot >= threshold;
  }

  private render(dt: number): void {
    this.post.render(this.world.scene, this.camera, {
      distortion: this.distortion,
      threat: this.threat,
      fade: this.fade,
      flash: this.flash,
      time: this.time,
    });
    void dt;
  }
}

function boot(): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  if (!canvas) return;
  try {
    new AsylumGame(canvas);
  } catch (error) {
    const hud = new Hud();
    hud.showError(
      `The asylum could not start: ${error instanceof Error ? error.message : String(error)}. ` +
        'A WebGL-capable browser is required.',
    );
    document.body.dataset.phase = 'error';
  }
}

boot();

export { MAX_DAYS };

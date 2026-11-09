import * as THREE from 'three';
import type { Hunter } from '../game/hunters';
import { glowTexture } from './textures';

export interface HunterView {
  group: THREE.Group;
  update(dt: number, hunter: Hunter): void;
  dispose(): void;
}

function std(color: number, roughness = 0.9, metalness = 0.05): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

/** Granny: hunched, apron, dragging feet, a lamp held low. */
export function createGrannyView(): HunterView {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const dressMat = std(0x2a2320, 1);
  const skinMat = std(0xb8a691, 0.85);
  const hairMat = std(0xcfc9c1, 1);
  const metalMat = std(0x6b5f4a, 0.5, 0.6);
  materials.push(dressMat, skinMat, hairMat, metalMat);

  const bodyGeo = new THREE.CapsuleGeometry(0.34, 0.95, 4, 10);
  geometries.push(bodyGeo);
  const body = new THREE.Mesh(bodyGeo, dressMat);
  body.position.y = 1.05;
  body.rotation.x = 0.22;
  group.add(body);

  const skirtGeo = new THREE.ConeGeometry(0.52, 0.95, 12);
  geometries.push(skirtGeo);
  const skirt = new THREE.Mesh(skirtGeo, dressMat);
  skirt.position.y = 0.5;
  group.add(skirt);

  const headGeo = new THREE.SphereGeometry(0.22, 14, 12);
  geometries.push(headGeo);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.set(0, 1.72, 0.1);
  group.add(head);

  const hairGeo = new THREE.SphereGeometry(0.235, 12, 10);
  geometries.push(hairGeo);
  const hair = new THREE.Mesh(hairGeo, hairMat);
  hair.position.set(0, 1.78, 0.06);
  hair.scale.set(1, 0.7, 1);
  group.add(hair);

  const eyeGeo = new THREE.SphereGeometry(0.035, 8, 8);
  geometries.push(eyeGeo);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  materials.push(eyeMat);
  const eyes = new THREE.Group();
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(side * 0.085, 1.73, 0.28);
    eyes.add(eye);
  }
  group.add(eyes);

  const armGeo = new THREE.CapsuleGeometry(0.075, 0.62, 3, 8);
  geometries.push(armGeo);
  const arms: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, skinMat);
    arm.position.set(side * 0.38, 1.16, 0.02);
    arm.rotation.z = side * 0.22;
    arms.push(arm);
    group.add(arm);
  }

  // The lamp she carries: it is how you spot her coming.
  const lampGeo = new THREE.SphereGeometry(0.13, 10, 10);
  geometries.push(lampGeo);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffc27a });
  materials.push(lampMat);
  const lamp = new THREE.Mesh(lampGeo, lampMat);
  lamp.position.set(0.46, 0.86, 0.16);
  group.add(lamp);

  const lampLight = new THREE.PointLight(0xffa552, 5, 7, 2);
  lampLight.position.copy(lamp.position);
  group.add(lampLight);

  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture('rgba(255,190,120,1)', 'rgba(255,120,40,0)'),
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  materials.push(glowMat);
  const glow = new THREE.Sprite(glowMat);
  glow.scale.set(2.4, 2.4, 1);
  glow.position.copy(lamp.position);
  group.add(glow);

  let time = 0;
  let lastPos = new THREE.Vector3();

  return {
    group,
    update(dt, hunter) {
      time += dt;
      group.position.set(hunter.pos.x, 0, hunter.pos.y);
      group.rotation.y = -hunter.facing + Math.PI / 2;

      const speed = group.position.distanceTo(lastPos) / Math.max(dt, 0.0001);
      lastPos.copy(group.position);
      const walk = Math.min(1, speed / 3);
      const stride = Math.sin(time * (5 + walk * 6)) * (0.25 + walk * 0.5);
      arms[0].rotation.x = stride;
      arms[1].rotation.x = -stride;
      body.position.y = 1.05 + Math.abs(Math.sin(time * (5 + walk * 6))) * 0.035 * walk;
      head.rotation.z = Math.sin(time * 1.7) * 0.08;
      eyes.position.y = Math.sin(time * 3.1) * 0.004;

      const chasing = hunter.state === 'chase';
      const stunned = hunter.state === 'stunned';
      lampLight.intensity = (stunned ? 1.5 : chasing ? 9 : 5) + Math.sin(time * 12) * 0.8;
      glowMat.opacity = stunned ? 0.2 : 0.45 + Math.sin(time * 8) * 0.1;
      body.rotation.x = stunned ? 0.6 : chasing ? 0.32 : 0.22;
    },
    dispose() {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => {
        const map = (m as THREE.MeshStandardMaterial).map;
        if (map) map.dispose();
        m.dispose();
      });
    },
  };
}

/** Mundiya: a silent shroud that drifts, with tendrils that never settle. */
export function createMundiyaView(): HunterView {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  const shroudMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a12,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.92,
  });
  materials.push(shroudMat);

  const shroudGeo = new THREE.ConeGeometry(0.62, 2.3, 14, 3, true);
  geometries.push(shroudGeo);
  const shroud = new THREE.Mesh(shroudGeo, shroudMat);
  shroud.position.y = 1.25;
  group.add(shroud);

  const headGeo = new THREE.SphereGeometry(0.26, 14, 12);
  geometries.push(headGeo);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x05050a, roughness: 1 });
  materials.push(headMat);
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 2.32;
  group.add(head);

  const eyeGeo = new THREE.SphereGeometry(0.042, 8, 8);
  geometries.push(eyeGeo);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xbfe9ff });
  materials.push(eyeMat);
  const eyes = new THREE.Group();
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(side * 0.1, 2.34, 0.24);
    eyes.add(eye);
  }
  group.add(eyes);

  const tendrilGeo = new THREE.CylinderGeometry(0.005, 0.05, 1.7, 6, 1, true);
  geometries.push(tendrilGeo);
  const tendrils: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i += 1) {
    const tendril = new THREE.Mesh(tendrilGeo, shroudMat);
    const angle = (i / 7) * Math.PI * 2;
    tendril.position.set(Math.cos(angle) * 0.34, 0.85, Math.sin(angle) * 0.34);
    tendril.rotation.z = Math.cos(angle) * 0.35;
    tendril.rotation.x = Math.sin(angle) * 0.35;
    tendrils.push(tendril);
    group.add(tendril);
  }

  const auraMat = new THREE.SpriteMaterial({
    map: glowTexture('rgba(150,120,255,1)', 'rgba(40,0,80,0)'),
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  materials.push(auraMat);
  const aura = new THREE.Sprite(auraMat);
  aura.scale.set(4.2, 4.6, 1);
  aura.position.y = 1.4;
  group.add(aura);

  const eyeLight = new THREE.PointLight(0x9fd8ff, 1.4, 6, 2);
  eyeLight.position.set(0, 2.3, 0.3);
  group.add(eyeLight);

  let time = 0;

  return {
    group,
    update(dt, hunter) {
      time += dt;
      const chasing = hunter.state === 'chase';
      group.position.set(hunter.pos.x, 0.12 + Math.sin(time * 1.6) * 0.08, hunter.pos.y);
      group.rotation.y = -hunter.facing + Math.PI / 2;

      tendrils.forEach((tendril, i) => {
        const sway = Math.sin(time * (1.4 + i * 0.23) + i) * (chasing ? 0.75 : 0.4);
        tendril.rotation.z = Math.cos((i / 7) * Math.PI * 2) * 0.35 + sway * 0.4;
        tendril.rotation.x = Math.sin((i / 7) * Math.PI * 2) * 0.35 + sway * 0.3;
        tendril.scale.y = 0.75 + Math.sin(time * 2 + i) * 0.18 + (chasing ? 0.35 : 0);
      });

      shroudMat.opacity = chasing ? 0.97 : 0.86;
      auraMat.opacity = (chasing ? 0.4 : 0.2) + Math.sin(time * 3) * 0.05;
      aura.scale.setScalar(chasing ? 5.4 : 4.2);
      eyeMat.color.setHex(chasing ? 0xffffff : 0xbfe9ff);
      eyeLight.intensity = chasing ? 3.2 : 1.2;
      head.position.y = 2.32 + Math.sin(time * 1.1) * 0.05;
    },
    dispose() {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => {
        const map = (m as THREE.SpriteMaterial).map;
        if (map) map.dispose();
        m.dispose();
      });
    },
  };
}

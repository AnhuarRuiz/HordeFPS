import * as THREE from 'three';
import type { CollisionBox } from '../world/Arena.ts';

export type ZombieKind = 'shambler' | 'runner' | 'brute';

interface ZombieConfig {
  speed: number;
  health: number;
  damage: number;
  scale: number;
  attackInterval: number;
}

const CONFIG: Record<ZombieKind, ZombieConfig> = {
  shambler: { speed: 1.8, health: 60, damage: 10, scale: 1, attackInterval: 0.9 },
  runner: { speed: 4.3, health: 38, damage: 8, scale: 0.82, attackInterval: 0.7 },
  brute: { speed: 1.25, health: 170, damage: 24, scale: 1.5, attackInterval: 1.2 },
};

// Four blocky looks (skin / shirt / pants / hair + eye glow) picked at random so
// a horde reads as a varied crowd rather than clones.
interface ZombieLook {
  skin: number;
  shirt: number;
  pants: number;
  hair: number;
  eye: number;
}

const LOOKS: ZombieLook[] = [
  // Classic rotten green
  { skin: 0x6f8f5a, shirt: 0x3a4a6a, pants: 0x242832, hair: 0x2a3320, eye: 0xff2d2d },
  // Hi-vis road worker
  { skin: 0x8a9d55, shirt: 0xc86a24, pants: 0x4a3826, hair: 0x241811, eye: 0xffc21f },
  // Pale office corpse
  { skin: 0xb8b1a1, shirt: 0xd2d5d9, pants: 0x33363d, hair: 0x1b1917, eye: 0xff2d2d },
  // Purple-grey putrid
  { skin: 0x6a5a6c, shirt: 0x5c2531, pants: 0x161418, hair: 0x0f0d10, eye: 0x9dff3d },
];

const ATTACK_RANGE = 1.15;
const RADIUS = 0.45;
const SEPARATION_RADIUS = 1.1;
const SEPARATION_FORCE = 2.4;
const DEATH_TIME = 0.9;

export interface ZombieUpdateResult {
  didAttack: boolean;
  damage: number;
}

export class Zombie {
  readonly group: THREE.Group;
  readonly hitbox: THREE.Mesh;
  readonly kind: ZombieKind;
  health: number;
  readonly maxHealth: number;

  private config: ZombieConfig;
  private torso: THREE.Mesh;
  private armL!: THREE.Group;
  private armR!: THREE.Group;
  private legL!: THREE.Group;
  private legR!: THREE.Group;
  private attackCooldown = 0;
  private lungeTimer = 0;
  private headBob = Math.random() * Math.PI * 2;
  private deathTimer = 0;
  private fallPitch = 0;
  private fallRoll = 0;
  private deathMats: THREE.Material[] = [];

  constructor(kind: ZombieKind, position: THREE.Vector3) {
    this.kind = kind;
    this.config = CONFIG[kind];
    this.health = this.config.health;
    this.maxHealth = this.config.health;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.scale.setScalar(this.config.scale);

    const look = LOOKS[Math.floor(Math.random() * LOOKS.length)];
    const skin = new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.9 });
    const shirt = new THREE.MeshStandardMaterial({ color: look.shirt, roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: look.pants, roughness: 0.85 });
    const hairMat = new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.95 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: look.eye, emissive: look.eye, emissiveIntensity: 1.5 });

    // Legs pivot at the hips so they can swing in a walk cycle.
    const legGeo = new THREE.BoxGeometry(0.22, 0.8, 0.22);
    this.legL = new THREE.Group();
    this.legL.position.set(-0.13, 0.8, 0);
    const legMeshL = new THREE.Mesh(legGeo, pants);
    legMeshL.position.y = -0.4;
    legMeshL.castShadow = true;
    this.legL.add(legMeshL);
    this.legR = new THREE.Group();
    this.legR.position.set(0.13, 0.8, 0);
    const legMeshR = new THREE.Mesh(legGeo, pants);
    legMeshR.position.y = -0.4;
    legMeshR.castShadow = true;
    this.legR.add(legMeshR);

    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.68, 0.3), shirt);
    this.torso.position.y = 1.14;
    this.torso.castShadow = true;

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.44), skin);
    head.position.y = 1.7;
    head.castShadow = true;

    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.12, 0.46), hairMat);
    hair.position.y = 1.94;

    const eyeGeo = new THREE.BoxGeometry(0.1, 0.06, 0.04);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.1, 1.72, 0.225);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.1;

    // Arms pivot at the shoulders, reaching forward in the classic zombie pose.
    const armGeo = new THREE.BoxGeometry(0.2, 0.6, 0.2);
    this.armL = new THREE.Group();
    this.armL.position.set(-0.34, 1.42, 0.02);
    this.armL.rotation.x = -1.4;
    const armMeshL = new THREE.Mesh(armGeo, skin);
    armMeshL.position.y = -0.28;
    armMeshL.castShadow = true;
    this.armL.add(armMeshL);
    this.armR = new THREE.Group();
    this.armR.position.set(0.34, 1.42, 0.02);
    this.armR.rotation.x = -1.4;
    const armMeshR = new THREE.Mesh(armGeo, skin);
    armMeshR.position.y = -0.28;
    armMeshR.castShadow = true;
    this.armR.add(armMeshR);

    this.group.add(this.legL, this.legR, this.torso, head, hair, eyeL, eyeR, this.armL, this.armR);

    this.hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 1.8, 0.7),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.hitbox.position.y = 0.9;
    this.hitbox.userData.zombieRef = this;
    this.group.add(this.hitbox);
  }

  get baseScale(): number {
    return this.config.scale;
  }

  isAlive(): boolean {
    return this.health > 0;
  }

  takeDamage(amount: number) {
    this.health = Math.max(0, this.health - amount);
  }

  // Kick off the death animation: topple backward over the feet, limbs going
  // limp. Materials are made transparent so we can fade the body as it sinks.
  startDeath() {
    this.deathTimer = 0;
    this.fallPitch = 1.5 + (Math.random() - 0.5) * 0.3; // ~90° onto its back
    this.fallRoll = (Math.random() - 0.5) * 0.7;
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material as THREE.Material | undefined;
      if (mat && 'opacity' in mat && !this.deathMats.includes(mat)) {
        mat.transparent = true;
        this.deathMats.push(mat);
      }
    });
  }

  // Advance the death animation; returns true once the body should be removed.
  updateDeath(dt: number): boolean {
    this.deathTimer += dt;
    const t = Math.min(1, this.deathTimer / DEATH_TIME);

    // Topple over the feet with an ease-out during the first part.
    const fallT = Math.min(1, t / 0.4);
    const fe = 1 - Math.pow(1 - fallT, 3);
    this.group.rotation.x = this.fallPitch * fe;
    this.group.rotation.z = this.fallRoll * fe;

    // Limbs go limp: arms flop down, legs splay.
    this.armL.rotation.x = -1.4 + fe * 1.5;
    this.armR.rotation.x = -1.4 + fe * 1.5;
    this.legL.rotation.x = fe * 0.5;
    this.legR.rotation.x = -fe * 0.5;

    // A small hop as it falls, then sink into the ground and fade out.
    const hop = fallT < 1 ? Math.sin(fallT * Math.PI) * 0.12 : 0;
    const sinkT = Math.max(0, (t - 0.6) / 0.4);
    this.group.position.y = hop - sinkT * 1.1;
    const opacity = 1 - sinkT;
    for (const mat of this.deathMats) (mat as THREE.MeshStandardMaterial).opacity = opacity;

    return t >= 1;
  }

  update(dt: number, playerPos: THREE.Vector3, others: Zombie[], collisionBoxes: CollisionBox[]): ZombieUpdateResult {
    const toPlayer = new THREE.Vector2(playerPos.x - this.group.position.x, playerPos.z - this.group.position.z);
    const dist = toPlayer.length();

    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.lungeTimer = Math.max(0, this.lungeTimer - dt);

    let didAttack = false;
    if (dist <= ATTACK_RANGE) {
      if (this.attackCooldown <= 0) {
        this.attackCooldown = this.config.attackInterval;
        this.lungeTimer = 0.2;
        didAttack = true;
      }
    } else if (dist > 0.001) {
      const dir = toPlayer.multiplyScalar(1 / dist);
      const separation = new THREE.Vector2();
      for (const other of others) {
        if (other === this || !other.isAlive()) continue;
        const away = new THREE.Vector2(
          this.group.position.x - other.group.position.x,
          this.group.position.z - other.group.position.z,
        );
        const d = away.length();
        if (d > 0.001 && d < SEPARATION_RADIUS) {
          separation.addScaledVector(away.normalize(), (SEPARATION_RADIUS - d) / SEPARATION_RADIUS);
        }
      }

      const move = dir.clone().addScaledVector(separation, SEPARATION_FORCE);
      if (move.lengthSq() > 0) {
        move.normalize();
        const step = move.multiplyScalar(this.config.speed * dt);
        const next = new THREE.Vector2(this.group.position.x + step.x, this.group.position.z + step.y);
        resolveZombieCollision(next, collisionBoxes);
        this.group.position.x = next.x;
        this.group.position.z = next.y;
      }
      this.group.rotation.y = Math.atan2(dir.x, dir.y);
    }

    this.headBob += dt * (dist > ATTACK_RANGE ? this.config.speed * 1.6 : 4);
    const lunge = this.lungeTimer > 0 ? Math.sin(((0.2 - this.lungeTimer) / 0.2) * Math.PI) * 0.25 : 0;
    this.group.position.y = Math.abs(Math.sin(this.headBob)) * 0.05;
    this.torso.position.z = lunge;

    // Walk cycle: legs swing opposite each other, arms sway lightly. Legs settle
    // when the zombie is in melee range and lunging instead of walking.
    const swing = dist > ATTACK_RANGE ? Math.sin(this.headBob) : 0;
    this.legL.rotation.x = swing * 0.5;
    this.legR.rotation.x = -swing * 0.5;
    this.armL.rotation.x = -1.4 + lunge * 1.2 + swing * 0.15;
    this.armR.rotation.x = -1.4 + lunge * 1.2 - swing * 0.15;

    return { didAttack, damage: didAttack ? this.config.damage : 0 };
  }
}

function resolveZombieCollision(next: THREE.Vector2, boxes: CollisionBox[]) {
  for (const box of boxes) {
    const closestX = Math.max(box.minX, Math.min(next.x, box.maxX));
    const closestZ = Math.max(box.minZ, Math.min(next.y, box.maxZ));
    const dx = next.x - closestX;
    const dz = next.y - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < RADIUS * RADIUS && distSq > 1e-9) {
      const dist = Math.sqrt(distSq);
      const push = RADIUS - dist;
      next.x += (dx / dist) * push;
      next.y += (dz / dist) * push;
    }
  }
}

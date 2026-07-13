import * as THREE from 'three';
import type { CollisionBox } from '../world/Arena.ts';

export type ZombieKind = 'shambler' | 'runner' | 'brute';

interface ZombieConfig {
  speed: number;
  health: number;
  damage: number;
  scale: number;
  color: number;
  attackInterval: number;
}

const CONFIG: Record<ZombieKind, ZombieConfig> = {
  shambler: { speed: 1.8, health: 60, damage: 10, scale: 1, color: 0x5c7a4d, attackInterval: 0.9 },
  runner: { speed: 4.3, health: 38, damage: 8, scale: 0.82, color: 0x8a5a3d, attackInterval: 0.7 },
  brute: { speed: 1.25, health: 170, damage: 24, scale: 1.5, color: 0x4d4f5c, attackInterval: 1.2 },
};

const ATTACK_RANGE = 1.15;
const RADIUS = 0.45;
const SEPARATION_RADIUS = 1.1;
const SEPARATION_FORCE = 2.4;

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
  private attackCooldown = 0;
  private lungeTimer = 0;
  private headBob = Math.random() * Math.PI * 2;

  constructor(kind: ZombieKind, position: THREE.Vector3) {
    this.kind = kind;
    this.config = CONFIG[kind];
    this.health = this.config.health;
    this.maxHealth = this.config.health;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.scale.setScalar(this.config.scale);

    const skin = new THREE.MeshStandardMaterial({ color: this.config.color, roughness: 0.85 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff2d2d, emissive: 0xff2d2d, emissiveIntensity: 1.4 });

    this.torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.7, 4, 8), skin);
    this.torso.position.y = 0.9;
    this.torso.castShadow = true;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 10), skin);
    head.position.y = 1.55;
    head.castShadow = true;

    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), eyeMat);
    eyeL.position.set(-0.1, 1.57, 0.22);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.1;

    const armGeo = new THREE.CapsuleGeometry(0.09, 0.55, 4, 6);
    const armL = new THREE.Mesh(armGeo, skin);
    armL.position.set(-0.42, 1.05, 0.15);
    armL.rotation.z = 0.5;
    armL.rotation.x = -0.4;
    const armR = armL.clone();
    armR.position.x = 0.42;
    armR.rotation.z = -0.5;

    const legGeo = new THREE.BoxGeometry(0.15, 0.85, 0.15);
    const legL = new THREE.Mesh(legGeo, skin);
    legL.position.set(-0.14, 0.425, 0);
    legL.castShadow = true;
    const legR = legL.clone();
    legR.position.x = 0.14;

    this.group.add(this.torso, head, eyeL, eyeR, armL, armR, legL, legR);

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

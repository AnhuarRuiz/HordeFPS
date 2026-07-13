import * as THREE from 'three';
import { Zombie, type ZombieKind } from '../entities/Zombie.ts';
import type { CollisionBox } from '../world/Arena.ts';

const SPAWN_INTERVAL = 0.55;
const INTERMISSION_TIME = 4.5;

export type WaveState = 'spawning' | 'active' | 'intermission';

export interface WaveUpdateResult {
  damageToPlayer: number;
}

export class WaveManager {
  waveNumber = 0;
  state: WaveState = 'intermission';
  intermissionRemaining = 1.5;

  readonly alive: Zombie[] = [];

  private scene: THREE.Scene;
  private spawnPoints: THREE.Vector3[];
  private collisionBoxes: CollisionBox[];
  private onZombieKilled: (kind: ZombieKind) => void;

  private queue: ZombieKind[] = [];
  private spawnTimer = 0;
  private dying: Zombie[] = [];

  constructor(
    scene: THREE.Scene,
    spawnPoints: THREE.Vector3[],
    collisionBoxes: CollisionBox[],
    onZombieKilled: (kind: ZombieKind) => void,
  ) {
    this.scene = scene;
    this.spawnPoints = spawnPoints;
    this.collisionBoxes = collisionBoxes;
    this.onZombieKilled = onZombieKilled;
  }

  get zombiesRemaining(): number {
    return this.alive.length + this.queue.length;
  }

  get raycastTargets(): THREE.Object3D[] {
    return this.alive.map((z) => z.hitbox);
  }

  private buildWaveQueue(wave: number): ZombieKind[] {
    const count = Math.min(4 + wave * 3, 40);
    const spawns: ZombieKind[] = [];
    for (let i = 0; i < count; i++) {
      const roll = Math.random();
      let kind: ZombieKind = 'shambler';
      if (wave >= 2 && roll < Math.min(0.15 + wave * 0.03, 0.45)) kind = 'runner';
      if (wave >= 3 && roll > 0.85 && roll < Math.min(0.85 + wave * 0.01, 0.97)) kind = 'brute';
      spawns.push(kind);
    }
    return spawns;
  }

  private startWave() {
    this.waveNumber += 1;
    this.queue = this.buildWaveQueue(this.waveNumber);
    this.spawnTimer = 0;
    this.state = 'spawning';
  }

  private spawnOne(kind: ZombieKind) {
    const base = this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
    const jitterX = (Math.random() - 0.5) * 1.5;
    const jitterZ = (Math.random() - 0.5) * 1.5;
    const pos = new THREE.Vector3(base.x + jitterX, 0, base.z + jitterZ);
    const zombie = new Zombie(kind, pos);
    this.scene.add(zombie.group);
    this.alive.push(zombie);
  }

  update(dt: number, playerPos: THREE.Vector3): WaveUpdateResult {
    if (this.state === 'intermission') {
      this.intermissionRemaining -= dt;
      if (this.intermissionRemaining <= 0) this.startWave();
      return { damageToPlayer: 0 };
    }

    if (this.state === 'spawning') {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0 && this.queue.length > 0) {
        this.spawnTimer = SPAWN_INTERVAL;
        const next = this.queue.shift()!;
        this.spawnOne(next);
      }
      if (this.queue.length === 0) this.state = 'active';
    }

    let damageToPlayer = 0;
    for (const zombie of this.alive) {
      const result = zombie.update(dt, playerPos, this.alive, this.collisionBoxes);
      if (result.didAttack) damageToPlayer += result.damage;
    }

    for (let i = this.alive.length - 1; i >= 0; i--) {
      const zombie = this.alive[i];
      if (!zombie.isAlive()) {
        this.alive.splice(i, 1);
        zombie.startDeath();
        this.dying.push(zombie);
        this.onZombieKilled(zombie.kind);
      }
    }

    for (let i = this.dying.length - 1; i >= 0; i--) {
      if (this.dying[i].updateDeath(dt)) {
        this.scene.remove(this.dying[i].group);
        this.dying.splice(i, 1);
      }
    }

    if (this.state === 'active' && this.alive.length === 0 && this.queue.length === 0) {
      this.state = 'intermission';
      this.intermissionRemaining = INTERMISSION_TIME;
    }

    return { damageToPlayer };
  }
}

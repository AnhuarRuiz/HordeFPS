import * as THREE from 'three';

// Small blood-cube spatter kicked out from a hit, a stronger gush of it at the
// moment of death, plus a floor pool and nearby wall/cover splatter that
// spreads outward before settling. All cheap unlit meshes so a horde of these
// doesn't cost much, and everything persistent is capped so it doesn't grow
// forever.
const PARTICLE_LIFETIME = 0.45;
const PARTICLE_GRAVITY = 9;
const MAX_POOLS = 40;
const MAX_WALL_SPLATS = 60;
const MAX_DRIPS = 40;

// Rays cast outward from a kill to find nearby solid surfaces to stain.
const WALL_SPLATTER_RAYS = 8;
const WALL_SPLATTER_RANGE = 2.4;

// How long a fresh pool/splat takes to spread from a small spurt to full size.
const GROW_TIME = 0.45;

const particleGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
const dripGeo = new THREE.PlaneGeometry(1, 1);
// CircleGeometry (and the blob variants below) face +Z by default; splats are
// aligned from that axis onto the hit surface's normal, then spun around it.
const Z_AXIS = new THREE.Vector3(0, 0, 1);

// A handful of precomputed irregular "blob" shapes stand in for a single
// perfect circle, so pools and splats read as organic spatter rather than
// stamped decals. Built once at module load and picked from at random.
function buildBlobGeometry(sides: number, irregularity: number): THREE.BufferGeometry {
  const harmonics = [
    { freq: 2 + Math.floor(Math.random() * 2), amp: irregularity * (0.35 + Math.random() * 0.35), phase: Math.random() * Math.PI * 2 },
    { freq: 3 + Math.floor(Math.random() * 3), amp: irregularity * (0.2 + Math.random() * 0.3), phase: Math.random() * Math.PI * 2 },
    { freq: 5 + Math.floor(Math.random() * 3), amp: irregularity * 0.15, phase: Math.random() * Math.PI * 2 },
  ];
  const positions: number[] = [0, 0, 0];
  const uvs: number[] = [0.5, 0.5];
  const angleStep = (Math.PI * 2) / sides;
  for (let i = 0; i <= sides; i++) {
    const angle = i * angleStep;
    let r = 1;
    for (const h of harmonics) r += h.amp * Math.sin(angle * h.freq + h.phase);
    r = Math.max(0.45, r);
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    positions.push(x, y, 0);
    uvs.push(0.5 + x * 0.5, 0.5 + y * 0.5);
  }
  const indices: number[] = [];
  for (let i = 1; i <= sides; i++) indices.push(0, i, i + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

const POOL_BLOBS = Array.from({ length: 6 }, () => buildBlobGeometry(16, 0.4));
const SPLAT_BLOBS = Array.from({ length: 6 }, () => buildBlobGeometry(11, 0.45));

function randomOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBloodColor(): THREE.Color {
  return new THREE.Color(0.35 + Math.random() * 0.25, 0.01, 0.01);
}

// Ease-out-back: overshoots past 1 then settles — reads as blood spurting out
// and slumping rather than a decal politely fading in.
function easeOutBack(t: number): number {
  const c1 = 1.7;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

interface Particle {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  velocity: THREE.Vector3;
  life: number;
}

interface Decal {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  finalScale: number;
  growTimer: number;
}

interface Drip {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
}

export class BloodEffects {
  private scene: THREE.Scene;
  private solidMeshes: THREE.Object3D[];
  private particles: Particle[] = [];
  private pools: Decal[] = [];
  private wallSplats: Decal[] = [];
  private drips: Drip[] = [];
  private raycaster = new THREE.Raycaster();
  private normalMatrix = new THREE.Matrix3();

  // `solidMeshes` are the walls/cover a kill can splatter onto — the same list
  // used for bullet raycasting, so anything a shot can hit, blood can stain.
  constructor(scene: THREE.Scene, solidMeshes: THREE.Object3D[]) {
    this.scene = scene;
    this.solidMeshes = solidMeshes;
    this.raycaster.far = WALL_SPLATTER_RANGE;
  }

  // Spatter kicked out from a bullet/knife impact at the hit point.
  spawnHit(position: THREE.Vector3, headshot: boolean) {
    this.burst(position, headshot ? 8 : 5, 1.2, 2.6, 1, 2.2);
  }

  // Everything a kill leaves behind: a stronger gush of flying spatter, a
  // spreading pool on the floor, and splatter on any wall or cover close
  // enough to have caught the spray.
  spawnDeath(position: THREE.Vector3) {
    this.burst(position, 14, 1.8, 4.2, 1.6, 3.4);
    this.spawnPool(position);
    this.spatterNearbySurfaces(position);
  }

  private burst(position: THREE.Vector3, count: number, speedMin: number, speedMax: number, upMin: number, upMax: number) {
    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshBasicMaterial({ color: randomBloodColor() });
      const mesh = new THREE.Mesh(particleGeo, material);
      mesh.position.copy(position);
      mesh.scale.setScalar(0.6 + Math.random() * 0.8);
      const angle = Math.random() * Math.PI * 2;
      const speed = speedMin + Math.random() * (speedMax - speedMin);
      const velocity = new THREE.Vector3(Math.cos(angle) * speed, upMin + Math.random() * (upMax - upMin), Math.sin(angle) * speed);
      this.scene.add(mesh);
      this.particles.push({ mesh, material, velocity, life: PARTICLE_LIFETIME });
    }
  }

  // An irregular pool, spawned small and spread out to full size, left on the
  // floor where a zombie died.
  private spawnPool(position: THREE.Vector3) {
    const material = new THREE.MeshBasicMaterial({ color: 0x3a0505, transparent: true, opacity: 0.8 });
    const mesh = new THREE.Mesh(randomOf(POOL_BLOBS), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.position.set(position.x, 0.015, position.z);
    const finalScale = 0.45 + Math.random() * 0.55;
    mesh.scale.setScalar(0.05);
    this.scene.add(mesh);
    this.pools.push({ mesh, material, finalScale, growTimer: GROW_TIME });
    if (this.pools.length > MAX_POOLS) {
      const old = this.pools.shift()!;
      this.scene.remove(old.mesh);
      old.material.dispose();
    }
  }

  // Casts a ring of rays out from roughly torso height and, wherever one hits
  // a wall or cover box within range, leaves a blood decal on that surface —
  // so a kill against (or near) a wall actually marks it, sometimes with a
  // drip running down from the impact.
  private spatterNearbySurfaces(position: THREE.Vector3) {
    const origin = new THREE.Vector3(position.x, 1.2, position.z);
    for (let i = 0; i < WALL_SPLATTER_RAYS; i++) {
      const angle = (i / WALL_SPLATTER_RAYS) * Math.PI * 2 + Math.random() * 0.4;
      const dir = new THREE.Vector3(Math.cos(angle), (Math.random() - 0.5) * 0.35, Math.sin(angle)).normalize();
      this.raycaster.set(origin, dir);
      const hits = this.raycaster.intersectObjects(this.solidMeshes, false);
      if (hits.length === 0 || !hits[0].face) continue;
      const hit = hits[0];
      this.normalMatrix.getNormalMatrix(hit.object.matrixWorld);
      const normal = hit.face!.normal.clone().applyMatrix3(this.normalMatrix).normalize();
      this.spawnWallSplat(hit.point, normal);
    }
  }

  private spawnWallSplat(point: THREE.Vector3, normal: THREE.Vector3) {
    const material = new THREE.MeshBasicMaterial({
      color: randomBloodColor(),
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(randomOf(SPLAT_BLOBS), material);
    const align = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, normal);
    const twist = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, Math.random() * Math.PI * 2);
    mesh.quaternion.copy(align).multiply(twist);
    // Nudged off the surface so it doesn't z-fight with the wall it's on.
    mesh.position.copy(point).addScaledVector(normal, 0.008);
    const finalScale = 0.3 + Math.random() * 0.4;
    mesh.scale.setScalar(0.05);
    this.scene.add(mesh);
    this.wallSplats.push({ mesh, material, finalScale, growTimer: GROW_TIME });
    if (this.wallSplats.length > MAX_WALL_SPLATS) {
      const old = this.wallSplats.shift()!;
      this.scene.remove(old.mesh);
      old.material.dispose();
    }

    // Most splats get a drip or two running down from them, as if still wet.
    if (Math.random() < 0.7) {
      const dripCount = 1 + Math.floor(Math.random() * 2);
      for (let i = 0; i < dripCount; i++) this.spawnDrip(point, normal);
    }
  }

  private spawnDrip(point: THREE.Vector3, normal: THREE.Vector3) {
    const material = new THREE.MeshBasicMaterial({
      color: randomBloodColor(),
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(dripGeo, material);
    const align = new THREE.Quaternion().setFromUnitVectors(Z_AXIS, normal);
    mesh.quaternion.copy(align);
    const width = 0.02 + Math.random() * 0.025;
    const length = 0.12 + Math.random() * 0.32;
    mesh.scale.set(width, length, 1);
    // Offset down (in world space) and off to the side a little, then pull the
    // plane's own pivot to its top edge so it grows downward from the splat.
    const sideJitter = (Math.random() - 0.5) * 0.12;
    mesh.position
      .copy(point)
      .addScaledVector(normal, 0.006)
      .add(new THREE.Vector3(sideJitter, -length / 2, sideJitter * 0.3));
    this.scene.add(mesh);
    this.drips.push({ mesh, material });
    if (this.drips.length > MAX_DRIPS) {
      const old = this.drips.shift()!;
      this.scene.remove(old.mesh);
      old.material.dispose();
    }
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.velocity.y -= PARTICLE_GRAVITY * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      if (p.mesh.position.y < 0.03) {
        p.mesh.position.y = 0.03;
        p.velocity.set(0, 0, 0);
      }
      p.material.opacity = Math.min(1, p.life / PARTICLE_LIFETIME);
      p.material.transparent = true;
    }

    this.updateGrowing(this.pools, dt);
    this.updateGrowing(this.wallSplats, dt);
  }

  private updateGrowing(decals: Decal[], dt: number) {
    for (const d of decals) {
      if (d.growTimer <= 0) continue;
      d.growTimer = Math.max(0, d.growTimer - dt);
      const t = 1 - d.growTimer / GROW_TIME;
      d.mesh.scale.setScalar(Math.max(0.05, easeOutBack(t)) * d.finalScale);
    }
  }
}

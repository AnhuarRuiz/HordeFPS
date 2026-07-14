import * as THREE from 'three';
import type { CollisionBox } from '../world/Arena.ts';
import { playZombieGroan } from '../systems/Audio.ts';

export type ZombieKind = 'shambler' | 'runner' | 'brute';
export type HitZone = 'head' | 'body';

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
const AVOID_RADIUS = 0.85;
const AVOID_LOOKAHEAD = 1.1;
const SEPARATION_RADIUS = 1.1;
const SEPARATION_FORCE = 2.4;
const DEATH_TIME = 0.9;
const FLASH_COLOR = new THREE.Color(0xff2222);

// Movement style, independent of kind (mostly): gives the horde varied
// silhouettes and gaits instead of every zombie playing the same walk cycle.
// - shamble: the default drunk stumble-walk.
// - crawl: a squashed, hunched drag along the ground — slow but low-profile.
// - sprint: frantic weaving run (runners).
// - lumber: heavy, near-relentless stomp (brutes).
type Gait = 'shamble' | 'crawl' | 'sprint' | 'lumber';

function pickGait(kind: ZombieKind): Gait {
  if (kind === 'brute') return 'lumber';
  if (kind === 'runner') return 'sprint';
  return Math.random() < 0.25 ? 'crawl' : 'shamble';
}

// How much each gait's heading weaves off a straight line to the player, in
// radians of steering noise per update — turns the horde's approach from a
// rigid beeline into something more organic. Kept subtle: too much lateral
// weave reads as sliding rather than stumbling.
const GAIT_WOBBLE: Record<Gait, number> = { shamble: 0.16, crawl: 0.07, sprint: 0.26, lumber: 0.045 };
// Crawlers drag themselves slower than they'd otherwise move.
const CRAWL_SPEED_MULT = 0.72;
// Forward pitch of the upper body for the crawl gait, in radians — hunches
// the torso/head/arms down and forward over the hips while the legs (which
// stay outside this pivot) keep their footing, reading as a low drag instead
// of a shrunken standing zombie.
const CRAWL_HUNCH = 1.05;

// Occasional desperate speed burst when a zombie senses the player nearby —
// the "starving" lurch the horde should feel like it's making.
const FRENZY_RANGE = 7;
const FRENZY_DURATION = 0.45;
const FRENZY_MULT: Record<Gait, number> = { shamble: 1.7, crawl: 1.55, lumber: 1.3, sprint: 1 };

// Geometries are identical across every zombie (only the group's uniform
// scale differs per kind), so they're built once here and shared. Materials
// stay per-instance: they carry the randomized look colors and need to flash
// independently on hit, so sharing them isn't worth the small saving.
const legGeo = new THREE.BoxGeometry(0.22, 0.8, 0.22);
const torsoGeo = new THREE.BoxGeometry(0.52, 0.68, 0.3);
const headGeo = new THREE.BoxGeometry(0.44, 0.44, 0.44);
const hairGeo = new THREE.BoxGeometry(0.46, 0.12, 0.46);
const eyeGeo = new THREE.BoxGeometry(0.1, 0.06, 0.04);
const armGeo = new THREE.BoxGeometry(0.2, 0.6, 0.2);
const bodyHitboxGeo = new THREE.BoxGeometry(0.6, 1.5, 0.55);
const headHitboxGeo = new THREE.BoxGeometry(0.5, 0.55, 0.5);
const hitboxMaterial = new THREE.MeshBasicMaterial({ visible: false });

// Gore so the horde reads as freshly fed rather than just grey and generic.
const woundGeo = new THREE.BoxGeometry(0.18, 0.14, 0.03);
const mouthBloodGeo = new THREE.BoxGeometry(0.15, 0.05, 0.05);
const dripGeo = new THREE.BoxGeometry(0.025, 0.18, 0.02);

// Torso/head/hair/eyes/arms all pivot together from hip height so the crawl
// gait can hunch the whole upper body forward in one rotation (see
// CRAWL_HUNCH) while the legs, planted separately at the same height, keep
// their footing on the ground.
const HIP_HEIGHT = 0.8;

export interface ZombieUpdateResult {
  didAttack: boolean;
  damage: number;
}

export class Zombie {
  readonly group: THREE.Group;
  /** Both raycast targets: userData.zone tells the caller which zone was hit. */
  readonly hitboxes: THREE.Mesh[];
  readonly kind: ZombieKind;
  health: number;
  readonly maxHealth: number;

  private config: ZombieConfig;
  private upperBody!: THREE.Group;
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
  private instanceMats: THREE.MeshStandardMaterial[] = [];

  private flashMaterials: THREE.MeshStandardMaterial[];
  private flashBaseEmissive: THREE.Color[];
  private flashBaseIntensity: number[];
  private flashTimer = 0;
  private flashDuration = 0.14;
  private groanCooldown = 1 + Math.random() * 4;

  private readonly gait: Gait;
  private wobbleTime = Math.random() * 10;
  private readonly wobblePhase = Math.random() * Math.PI * 2;
  private readonly wobbleFreq = 0.55 + Math.random() * 0.6;
  private readonly legPhaseOffset = (Math.random() - 0.5) * 0.6;
  private frenzyTimer = 0;
  private frenzyCooldown = 1 + Math.random() * 2;

  // Scratch vectors reused every frame instead of allocating in the hot path.
  private scratchToPlayer = new THREE.Vector2();
  private scratchDir = new THREE.Vector2();
  private scratchSeparation = new THREE.Vector2();
  private scratchAway = new THREE.Vector2();
  private scratchMove = new THREE.Vector2();
  private scratchNext = new THREE.Vector2();

  constructor(kind: ZombieKind, position: THREE.Vector3) {
    this.kind = kind;
    this.config = CONFIG[kind];
    this.health = this.config.health;
    this.maxHealth = this.config.health;

    this.gait = pickGait(kind);

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.scale.setScalar(this.config.scale);

    const look = LOOKS[Math.floor(Math.random() * LOOKS.length)];
    const skin = new THREE.MeshStandardMaterial({ color: look.skin, roughness: 0.9 });
    const shirt = new THREE.MeshStandardMaterial({ color: look.shirt, roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: look.pants, roughness: 0.85 });
    const hairMat = new THREE.MeshStandardMaterial({ color: look.hair, roughness: 0.95 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: look.eye, emissive: look.eye, emissiveIntensity: 1.5 });
    this.instanceMats = [skin, shirt, pants, hairMat, eyeMat];
    this.flashMaterials = [skin, shirt, pants, hairMat];
    this.flashBaseEmissive = this.flashMaterials.map((m) => m.emissive.clone());
    this.flashBaseIntensity = this.flashMaterials.map((m) => m.emissiveIntensity);

    // Legs pivot at the hips so they can swing in a walk cycle. They stay
    // direct children of the group (not the upper-body pivot below) so a
    // crawler's hunch doesn't drag its feet off the ground.
    this.legL = new THREE.Group();
    this.legL.position.set(-0.13, HIP_HEIGHT, 0);
    const legMeshL = new THREE.Mesh(legGeo, pants);
    legMeshL.position.y = -0.4;
    legMeshL.castShadow = true;
    this.legL.add(legMeshL);
    this.legR = new THREE.Group();
    this.legR.position.set(0.13, HIP_HEIGHT, 0);
    const legMeshR = new THREE.Mesh(legGeo, pants);
    legMeshR.position.y = -0.4;
    legMeshR.castShadow = true;
    this.legR.add(legMeshR);

    // Everything above the hips shares one pivot at hip height, so the crawl
    // gait can hunch it forward as a single rotation later.
    this.upperBody = new THREE.Group();
    this.upperBody.position.set(0, HIP_HEIGHT, 0);

    this.torso = new THREE.Mesh(torsoGeo, shirt);
    this.torso.position.y = 1.14 - HIP_HEIGHT;
    this.torso.castShadow = true;

    const head = new THREE.Mesh(headGeo, skin);
    head.position.y = 1.7 - HIP_HEIGHT;
    head.castShadow = true;

    // Gore: a bloodied wound on the torso with a couple of drips, and a
    // stained, snarling mouth. Emissive so it still reads dark blood-red in
    // this scene's dim lighting instead of disappearing into shadow.
    const bloodColor = new THREE.Color(0.35 + Math.random() * 0.25, 0.01, 0.01);
    const bloodMat = new THREE.MeshStandardMaterial({
      color: bloodColor,
      roughness: 0.35,
      metalness: 0.05,
      emissive: bloodColor.clone().multiplyScalar(0.55),
      emissiveIntensity: 0.8,
    });
    this.instanceMats.push(bloodMat);

    const wound = new THREE.Mesh(woundGeo, bloodMat);
    const woundX = (Math.random() - 0.5) * 0.2;
    const woundY = (Math.random() - 0.5) * 0.2;
    wound.position.set(woundX, woundY, 0.16);
    wound.rotation.z = (Math.random() - 0.5) * 0.6;
    this.torso.add(wound);

    const dripCount = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < dripCount; i++) {
      const drip = new THREE.Mesh(dripGeo, bloodMat);
      const dripLen = 0.5 + Math.random() * 0.8;
      drip.scale.y = dripLen;
      drip.position.set(woundX + (Math.random() - 0.5) * 0.12, woundY - 0.08 - dripLen * 0.09, 0.155);
      this.torso.add(drip);
    }

    const mouthBlood = new THREE.Mesh(mouthBloodGeo, bloodMat);
    mouthBlood.position.set(0, -0.14, 0.2);
    head.add(mouthBlood);

    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.y = 1.94 - HIP_HEIGHT;

    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.1, 1.72 - HIP_HEIGHT, 0.225);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.1;

    // Arms pivot at the shoulders, reaching forward in the classic zombie pose.
    this.armL = new THREE.Group();
    this.armL.position.set(-0.34, 1.42 - HIP_HEIGHT, 0.02);
    this.armL.rotation.x = -1.4;
    const armMeshL = new THREE.Mesh(armGeo, skin);
    armMeshL.position.y = -0.28;
    armMeshL.castShadow = true;
    this.armL.add(armMeshL);
    this.armR = new THREE.Group();
    this.armR.position.set(0.34, 1.42 - HIP_HEIGHT, 0.02);
    this.armR.rotation.x = -1.4;
    const armMeshR = new THREE.Mesh(armGeo, skin);
    armMeshR.position.y = -0.28;
    armMeshR.castShadow = true;
    this.armR.add(armMeshR);

    // Head zone lives on the upper-body pivot too, so it tracks the head
    // exactly (including the crawl hunch) instead of staying at standing
    // height once a zombie drops low.
    const headHitbox = new THREE.Mesh(headHitboxGeo, hitboxMaterial);
    headHitbox.position.y = 1.74 - HIP_HEIGHT;
    headHitbox.userData.zombieRef = this;
    headHitbox.userData.zone = 'head' satisfies HitZone;

    this.upperBody.add(this.torso, head, hair, eyeL, eyeR, this.armL, this.armR, headHitbox);
    this.group.add(this.legL, this.legR, this.upperBody);

    // Body zone stays a simple static box on the group (covering legs through
    // mid-torso across every gait) so aim matters via the head zone above
    // without needing a second pose-dependent hitbox.
    const bodyHitbox = new THREE.Mesh(bodyHitboxGeo, hitboxMaterial);
    bodyHitbox.position.y = 0.74;
    bodyHitbox.userData.zombieRef = this;
    bodyHitbox.userData.zone = 'body' satisfies HitZone;
    this.group.add(bodyHitbox);

    this.hitboxes = [bodyHitbox, headHitbox];
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

  // Briefly flash the body materials red so a hit reads clearly even before
  // the health bar / death animation catches up.
  flashHit(headshot: boolean) {
    this.flashDuration = headshot ? 0.2 : 0.13;
    this.flashTimer = this.flashDuration;
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

  // Frees the per-instance materials (colors/emissive are unique per zombie).
  // Geometries are module-level singletons shared by every zombie and must
  // never be disposed here.
  dispose() {
    for (const mat of this.instanceMats) mat.dispose();
  }

  update(dt: number, playerPos: THREE.Vector3, others: Zombie[], collisionBoxes: CollisionBox[]): ZombieUpdateResult {
    if (this.flashTimer > 0) {
      this.flashTimer = Math.max(0, this.flashTimer - dt);
      const t = this.flashTimer / this.flashDuration;
      for (let i = 0; i < this.flashMaterials.length; i++) {
        const m = this.flashMaterials[i];
        m.emissive.copy(this.flashBaseEmissive[i]).lerp(FLASH_COLOR, t);
        m.emissiveIntensity = this.flashBaseIntensity[i] + t * 3;
      }
    }

    this.scratchToPlayer.set(playerPos.x - this.group.position.x, playerPos.z - this.group.position.z);
    const dist = this.scratchToPlayer.length();

    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.lungeTimer = Math.max(0, this.lungeTimer - dt);

    this.groanCooldown -= dt;
    if (this.groanCooldown <= 0) {
      this.groanCooldown = 4 + Math.random() * 6;
      playZombieGroan(dist);
    }

    // Desperate hunger burst: an occasional speed lurch while closing in, so
    // the horde doesn't read as evenly-paced robots.
    this.frenzyCooldown -= dt;
    if (this.frenzyTimer > 0) this.frenzyTimer -= dt;
    if (
      this.frenzyTimer <= 0 &&
      this.frenzyCooldown <= 0 &&
      dist > ATTACK_RANGE &&
      dist < FRENZY_RANGE &&
      Math.random() < dt * 0.3
    ) {
      this.frenzyTimer = FRENZY_DURATION;
      this.frenzyCooldown = 1.5 + Math.random() * 2.5;
    }

    let didAttack = false;
    let effectiveSpeedMult = 1;
    if (dist <= ATTACK_RANGE) {
      if (this.attackCooldown <= 0 && !segmentBlocked(this.group.position.x, this.group.position.z, playerPos.x, playerPos.z, collisionBoxes)) {
        this.attackCooldown = this.config.attackInterval;
        this.lungeTimer = 0.2;
        didAttack = true;
      }
    } else if (dist > 0.001) {
      this.scratchDir.copy(this.scratchToPlayer).multiplyScalar(1 / dist);
      steerAroundObstacles(this.scratchDir, this.group.position.x, this.group.position.z, collisionBoxes);

      // Weave off the straight line to the player so the approach reads as a
      // stumbling, organic chase rather than a beeline. Amplitude depends on
      // the gait (frantic runners weave a lot, lumbering brutes barely at all).
      const wobbleAmt = GAIT_WOBBLE[this.gait];
      if (wobbleAmt > 0) {
        this.wobbleTime += dt * this.wobbleFreq;
        const wob = Math.sin(this.wobbleTime + this.wobblePhase) * wobbleAmt;
        const cos = Math.cos(wob);
        const sin = Math.sin(wob);
        const wx = this.scratchDir.x * cos - this.scratchDir.y * sin;
        const wz = this.scratchDir.x * sin + this.scratchDir.y * cos;
        this.scratchDir.set(wx, wz);
      }

      this.scratchSeparation.set(0, 0);
      for (const other of others) {
        if (other === this || !other.isAlive()) continue;
        this.scratchAway.set(
          this.group.position.x - other.group.position.x,
          this.group.position.z - other.group.position.z,
        );
        const d = this.scratchAway.length();
        if (d > 0.001 && d < SEPARATION_RADIUS) {
          this.scratchSeparation.addScaledVector(this.scratchAway.normalize(), (SEPARATION_RADIUS - d) / SEPARATION_RADIUS);
        }
      }

      this.scratchMove.copy(this.scratchDir).addScaledVector(this.scratchSeparation, SEPARATION_FORCE);
      if (this.scratchMove.lengthSq() > 0) {
        this.scratchMove.normalize();
        effectiveSpeedMult = this.gait === 'crawl' ? CRAWL_SPEED_MULT : 1;
        if (this.frenzyTimer > 0) effectiveSpeedMult *= FRENZY_MULT[this.gait];
        const stepX = this.scratchMove.x * this.config.speed * effectiveSpeedMult * dt;
        const stepZ = this.scratchMove.y * this.config.speed * effectiveSpeedMult * dt;
        this.scratchNext.set(this.group.position.x + stepX, this.group.position.z + stepZ);
        resolveZombieCollision(this.scratchNext, collisionBoxes);
        this.group.position.x = this.scratchNext.x;
        this.group.position.z = this.scratchNext.y;
        // Face the direction actually being walked (post-separation/wobble),
        // not just the raw line to the player, so the body doesn't appear to
        // slide sideways while facing forward.
        this.group.rotation.y = Math.atan2(this.scratchMove.x, this.scratchMove.y);
      }
    }

    const moving = dist > ATTACK_RANGE;
    // Leg-swing cadence tracks the zombie's actual ground speed (including the
    // crawl/frenzy multipliers) so the animation never outpaces or lags behind
    // how far the body is really moving — a mismatch there is what reads as
    // "skating" or floating instead of walking.
    const paceMult = this.gait === 'sprint' ? 1.15 : 1;
    this.headBob += dt * (moving ? this.config.speed * effectiveSpeedMult * paceMult : 4);
    const lunge = this.lungeTimer > 0 ? Math.sin(((0.2 - this.lungeTimer) / 0.2) * Math.PI) * 0.25 : 0;

    // Per-gait pose shape: how far legs/arms swing and how bouncy the stride
    // hop is. Crawlers additionally hunch their whole upper body forward.
    let legSwingScale = 0.5;
    let armSwingScale = 0.15;
    let hopScale = 0.05;
    switch (this.gait) {
      case 'crawl':
        legSwingScale = 0.18;
        armSwingScale = 0.4;
        hopScale = 0.02;
        break;
      case 'sprint':
        legSwingScale = 0.7;
        armSwingScale = 0.3;
        hopScale = 0.08;
        break;
      case 'lumber':
        legSwingScale = 0.65;
        armSwingScale = 0.12;
        hopScale = 0.03;
        break;
    }

    this.group.position.y = Math.abs(Math.sin(this.headBob)) * hopScale;
    this.upperBody.rotation.x = this.gait === 'crawl' ? CRAWL_HUNCH : 0;
    this.torso.position.z = lunge;

    // Walk cycle: legs swing opposite each other, arms sway lightly. Legs settle
    // when the zombie is in melee range and lunging instead of walking. A small
    // per-instance phase offset desyncs limbs slightly for a subtle limp.
    const swingPhase = this.headBob + (this.gait === 'shamble' || this.gait === 'lumber' ? this.legPhaseOffset : 0);
    const swing = moving ? Math.sin(swingPhase) : 0;
    this.legL.rotation.x = swing * legSwingScale;
    this.legR.rotation.x = -swing * legSwingScale;
    this.armL.rotation.x = -1.4 + lunge * 1.2 + swing * armSwingScale;
    this.armR.rotation.x = -1.4 + lunge * 1.2 - swing * armSwingScale;

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

// Nudges `dir` tangentially around the nearest obstacle ahead so zombies flow
// around cover instead of pressing straight into it and relying only on the
// after-the-fact push-out in resolveZombieCollision.
function steerAroundObstacles(dir: THREE.Vector2, px: number, pz: number, boxes: CollisionBox[]) {
  const aheadX = px + dir.x * AVOID_LOOKAHEAD;
  const aheadZ = pz + dir.y * AVOID_LOOKAHEAD;
  for (const box of boxes) {
    const closestX = Math.max(box.minX, Math.min(aheadX, box.maxX));
    const closestZ = Math.max(box.minZ, Math.min(aheadZ, box.maxZ));
    const dx = aheadX - closestX;
    const dz = aheadZ - closestZ;
    if (dx * dx + dz * dz < AVOID_RADIUS * AVOID_RADIUS) {
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      const toBoxX = cx - px;
      const toBoxZ = cz - pz;
      // Curve away from whichever side the box center sits on.
      const side = dir.x * toBoxZ - dir.y * toBoxX > 0 ? -1 : 1;
      const perpX = -dir.y * side;
      const perpZ = dir.x * side;
      dir.set(dir.x + perpX * 1.1, dir.y + perpZ * 1.1);
      dir.normalize();
      return;
    }
  }
}

// Slab-method segment-vs-AABB test in the XZ plane, used to stop zombies from
// "attacking" the player through cover they're pressed up against.
function segmentBlocked(x1: number, z1: number, x2: number, z2: number, boxes: CollisionBox[]): boolean {
  const dx = x2 - x1;
  const dz = z2 - z1;
  for (const box of boxes) {
    let tmin = 0;
    let tmax = 1;
    let blocked = true;
    if (Math.abs(dx) < 1e-9) {
      if (x1 < box.minX || x1 > box.maxX) blocked = false;
    } else {
      let t0 = (box.minX - x1) / dx;
      let t1 = (box.maxX - x1) / dx;
      if (t0 > t1) [t0, t1] = [t1, t0];
      tmin = Math.max(tmin, t0);
      tmax = Math.min(tmax, t1);
      if (tmin > tmax) blocked = false;
    }
    if (blocked && Math.abs(dz) < 1e-9) {
      if (z1 < box.minZ || z1 > box.maxZ) blocked = false;
    } else if (blocked) {
      let t0 = (box.minZ - z1) / dz;
      let t1 = (box.maxZ - z1) / dz;
      if (t0 > t1) [t0, t1] = [t1, t0];
      tmin = Math.max(tmin, t0);
      tmax = Math.min(tmax, t1);
      if (tmin > tmax) blocked = false;
    }
    if (blocked) return true;
  }
  return false;
}

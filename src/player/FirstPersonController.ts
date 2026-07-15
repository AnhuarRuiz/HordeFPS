import * as THREE from 'three';
import type { CollisionBox } from '../world/Arena.ts';

const EYE_HEIGHT = 1.7;
const PRONE_EYE_HEIGHT = 0.45;
const STANCE_LERP_RATE = 6;
const PLAYER_RADIUS = 0.4;
const MOVE_SPEED = 6;
const SPRINT_SPEED = 9.5;
const PRONE_SPEED = 1.6;
const ACCEL = 12;
const DAMPING = 10;
const JUMP_SPEED = 6.2;
const GRAVITY = -18;
const MOUSE_SENSITIVITY = 0.0022;
const TOUCH_LOOK_SENSITIVITY = 0.0032;
const AIM_SPEED_MULT = 0.55;

// Ledges up to this tall are walked/stepped straight over (curbs, low crates);
// anything taller blocks horizontally and must be mantled to get on top of.
const STEP_UP = 0.3;
// A ledge is mantle-able when its top sits between these heights above the feet:
// below MIN it's just a step, above MAX (e.g. the 5m boundary walls) it can't be
// climbed at all.
const MIN_MANTLE = 0.45;
const MAX_MANTLE = 2.0;
// How far past the player's own radius a ledge can be and still get grabbed.
const MANTLE_REACH = 0.5;

// Accelerates in, eases out — used for the rising phase of a mantle.
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Smooth both ends — used for the forward pull onto a ledge.
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class FirstPersonController {
  readonly camera: THREE.PerspectiveCamera;

  private domElement: HTMLElement;
  private collisionBoxes: CollisionBox[];
  private bounds: CollisionBox;
  private onLockChange: (locked: boolean) => void;

  private yaw = 0;
  private pitch = 0;

  private position = new THREE.Vector2(0, 0);
  private velocity = new THREE.Vector2(0, 0);
  private verticalVelocity = 0;
  // World Y of the player's feet. 0 is the arena floor; standing on a crate top
  // raises it. The camera sits eyeHeight above this.
  private feetY = 0;
  private grounded = true;

  // Vault/mantle state — while active, normal movement and gravity are bypassed
  // and the camera is driven along an eased climb path up onto a ledge.
  private mantling = false;
  private mantleTimer = 0;
  private mantleDuration = 0.5;
  private mantleStart = new THREE.Vector3();
  private mantleTarget = new THREE.Vector3();

  private keys = new Set<string>();
  private touchMoveX = 0;
  private touchMoveZ = 0;
  private _locked = false;
  private aiming = false;
  private prone = false;
  private eyeHeight = EYE_HEIGHT;
  private wishLen = 0;
  private touchSensitivity = 1;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    collisionBoxes: CollisionBox[],
    bounds: CollisionBox,
    startPosition: THREE.Vector3,
    onLockChange: (locked: boolean) => void,
  ) {
    this.camera = camera;
    this.domElement = domElement;
    this.collisionBoxes = collisionBoxes;
    this.bounds = bounds;
    this.onLockChange = onLockChange;
    this.position.set(startPosition.x, startPosition.z);

    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(this.position.x, EYE_HEIGHT, this.position.y);

    document.addEventListener('keydown', (e) => this.keys.add(e.code));
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    document.addEventListener('pointerlockchange', () => this.handleLockChange());
  }

  get locked(): boolean {
    return this._locked;
  }

  lock() {
    this.domElement.requestPointerLock();
  }

  // Touch devices have no pointer-lock concept (look is driven by drag deltas
  // instead), so this just flips the same "locked" flag the game loop checks.
  enableTouch() {
    this._locked = true;
    this.onLockChange(true);
  }

  press(code: string) {
    this.keys.add(code);
  }

  release(code: string) {
    this.keys.delete(code);
  }

  setTouchMove(x: number, z: number) {
    this.touchMoveX = x;
    this.touchMoveZ = z;
  }

  setAiming(aiming: boolean) {
    this.aiming = aiming;
  }

  get isProne(): boolean {
    return this.prone;
  }

  get isMantling(): boolean {
    return this.mantling;
  }

  // 0 -> 1 across the current mantle (0 when not mantling), for driving the
  // climbing-hands viewmodel in step with the camera's climb.
  get mantleProgress(): number {
    return this.mantling ? Math.min(1, this.mantleTimer / this.mantleDuration) : 0;
  }

  // Driven off the wished input direction (not actual velocity) so it flips
  // the instant a movement key is pressed/released, with no lag from the
  // accel/damping smoothing applied to the actual velocity.
  get isMoving(): boolean {
    return this.wishLen > 0.01;
  }

  // Edge-triggered toggle: dropping mid-air would leave the eye height lerping
  // toward the floor while still falling, so it's only allowed while grounded.
  toggleProne() {
    if (!this.grounded) return;
    this.prone = !this.prone;
  }

  addLookDelta(dx: number, dy: number) {
    this.applyLook(dx * TOUCH_LOOK_SENSITIVITY * this.touchSensitivity, dy * TOUCH_LOOK_SENSITIVITY * this.touchSensitivity);
  }

  // Multiplier on top of TOUCH_LOOK_SENSITIVITY, driven by the mobile settings slider.
  setTouchSensitivity(mult: number) {
    this.touchSensitivity = mult;
  }

  private handleLockChange() {
    this._locked = document.pointerLockElement === this.domElement;
    this.onLockChange(this._locked);
  }

  private handleMouseMove(e: MouseEvent) {
    if (!this._locked) return;
    this.applyLook(e.movementX * MOUSE_SENSITIVITY, e.movementY * MOUSE_SENSITIVITY);
  }

  private applyLook(dYaw: number, dPitch: number) {
    this.yaw -= dYaw;
    this.pitch -= dPitch;
    const limit = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }

  // Height-aware horizontal collision: a box only blocks the player when its top
  // stands more than a small step above the feet. Once the player is on top of
  // (or has stepped up onto) a box, its top is at/below foot level, so it stops
  // blocking and the player can walk freely across the top and off its edges.
  private resolveCollision(next: THREE.Vector2) {
    next.x = Math.max(this.bounds.minX + PLAYER_RADIUS, Math.min(this.bounds.maxX - PLAYER_RADIUS, next.x));
    next.y = Math.max(this.bounds.minZ + PLAYER_RADIUS, Math.min(this.bounds.maxZ - PLAYER_RADIUS, next.y));

    for (const box of this.collisionBoxes) {
      const top = box.top ?? Infinity;
      if (top <= this.feetY + STEP_UP) continue; // low enough to stand on / step over
      const closestX = Math.max(box.minX, Math.min(next.x, box.maxX));
      const closestZ = Math.max(box.minZ, Math.min(next.y, box.maxZ));
      const dx = next.x - closestX;
      const dz = next.y - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq < PLAYER_RADIUS * PLAYER_RADIUS && distSq > 1e-9) {
        const dist = Math.sqrt(distSq);
        const push = PLAYER_RADIUS - dist;
        next.x += (dx / dist) * push;
        next.y += (dz / dist) * push;
      }
    }
  }

  // The height of whatever surface is under the player at (x, z): the floor (0)
  // or the top of the highest box the player is standing over whose top is no
  // more than a step above the feet (so a tall box the player is standing beside
  // and below never counts as support).
  private computeSupportY(x: number, z: number): number {
    let support = 0;
    for (const box of this.collisionBoxes) {
      if (box.top === undefined) continue;
      if (box.top > this.feetY + STEP_UP) continue;
      const closestX = Math.max(box.minX, Math.min(x, box.maxX));
      const closestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
      const dx = x - closestX;
      const dz = z - closestZ;
      if (dx * dx + dz * dz > PLAYER_RADIUS * PLAYER_RADIUS) continue;
      if (box.top > support) support = box.top;
    }
    return support;
  }

  update(dt: number) {
    if (this.mantling) {
      this.updateMantle(dt);
      return;
    }

    const forward = new THREE.Vector2(-Math.sin(this.yaw), -Math.cos(this.yaw));
    const right = new THREE.Vector2(-forward.y, forward.x);

    let inputX = this.touchMoveX;
    let inputZ = this.touchMoveZ;
    if (this.keys.has('KeyW')) inputZ += 1;
    if (this.keys.has('KeyS')) inputZ -= 1;
    if (this.keys.has('KeyD')) inputX += 1;
    if (this.keys.has('KeyA')) inputX -= 1;

    const wishDir = new THREE.Vector2().addScaledVector(forward, inputZ).addScaledVector(right, inputX);
    if (wishDir.lengthSq() > 1) wishDir.normalize();
    this.wishLen = wishDir.length();

    // A jump pressed while facing/moving into a climbable ledge becomes a mantle
    // instead of a hop; drifting into a ledge while already airborne grabs it
    // too, for that automatic Apex/Titanfall-style vault feel.
    if (!this.prone && (this.keys.has('Space') || !this.grounded)) {
      if (this.tryStartMantle(forward, wishDir)) {
        this.updateMantle(dt);
        return;
      }
    }

    const sprinting = !this.prone && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
    const targetSpeed = this.prone
      ? PRONE_SPEED
      : (sprinting ? SPRINT_SPEED : MOVE_SPEED) * (this.aiming ? AIM_SPEED_MULT : 1);
    const targetVel = wishDir.clone().multiplyScalar(targetSpeed);

    const rate = wishDir.lengthSq() > 0 ? ACCEL : DAMPING;
    const t = Math.min(1, rate * dt);
    this.velocity.x += (targetVel.x - this.velocity.x) * t;
    this.velocity.y += (targetVel.y - this.velocity.y) * t;

    const next = this.position.clone().addScaledVector(this.velocity, dt);
    this.resolveCollision(next);
    this.position.copy(next);

    if (this.grounded && !this.prone && this.keys.has('Space')) {
      this.verticalVelocity = JUMP_SPEED;
      this.grounded = false;
    }
    this.verticalVelocity += GRAVITY * dt;
    this.feetY += this.verticalVelocity * dt;

    const support = this.computeSupportY(this.position.x, this.position.y);
    if (this.verticalVelocity <= 0 && this.feetY <= support) {
      this.feetY = support;
      this.verticalVelocity = 0;
      this.grounded = true;
    } else {
      this.grounded = this.feetY <= support + 1e-3;
    }

    const targetEyeHeight = this.prone ? PRONE_EYE_HEIGHT : EYE_HEIGHT;
    this.eyeHeight += (targetEyeHeight - this.eyeHeight) * Math.min(1, STANCE_LERP_RATE * dt);

    this.camera.position.set(this.position.x, this.feetY + this.eyeHeight, this.position.y);
  }

  // Scan for a climbable ledge in the direction the player is heading (movement
  // if any, otherwise where they're looking) and, if one is within reach and the
  // spot on top is clear, kick off a mantle onto it. Returns whether it started.
  private tryStartMantle(forward: THREE.Vector2, wishDir: THREE.Vector2): boolean {
    const dir = wishDir.lengthSq() > 0.04 ? wishDir.clone().normalize() : forward.clone();
    const px = this.position.x;
    const pz = this.position.y;
    const probeX = px + dir.x * (PLAYER_RADIUS + MANTLE_REACH);
    const probeZ = pz + dir.y * (PLAYER_RADIUS + MANTLE_REACH);

    let best: CollisionBox | null = null;
    for (const box of this.collisionBoxes) {
      if (box.top === undefined) continue;
      const rise = box.top - this.feetY;
      if (rise < MIN_MANTLE || rise > MAX_MANTLE) continue;
      // Pressed up against this box's side.
      const cx = Math.max(box.minX, Math.min(px, box.maxX));
      const cz = Math.max(box.minZ, Math.min(pz, box.maxZ));
      const bdx = px - cx;
      const bdz = pz - cz;
      if (bdx * bdx + bdz * bdz > (PLAYER_RADIUS + MANTLE_REACH) ** 2) continue;
      // Reaching onto its top (probe point falls inside the footprint).
      if (probeX < box.minX || probeX > box.maxX || probeZ < box.minZ || probeZ > box.maxZ) continue;
      // Actually heading toward it, not just brushing past.
      const toBoxX = (box.minX + box.maxX) / 2 - px;
      const toBoxZ = (box.minZ + box.maxZ) / 2 - pz;
      if (dir.x * toBoxX + dir.y * toBoxZ <= 0) continue;
      if (!best || box.top < best.top!) best = box; // prefer the lowest grabbable ledge
    }
    if (!best) return false;

    // Land a little inward from the lip so the player ends fully on top.
    const targetX = Math.max(best.minX + PLAYER_RADIUS, Math.min(best.maxX - PLAYER_RADIUS, probeX + dir.x * PLAYER_RADIUS));
    const targetZ = Math.max(best.minZ + PLAYER_RADIUS, Math.min(best.maxZ - PLAYER_RADIUS, probeZ + dir.y * PLAYER_RADIUS));

    // Abort if a taller box occupies that landing spot (would clip us inside it).
    for (const box of this.collisionBoxes) {
      if (box === best || box.top === undefined) continue;
      if (box.top <= best.top! + 0.05) continue;
      if (targetX > box.minX && targetX < box.maxX && targetZ > box.minZ && targetZ < box.maxZ) return false;
    }

    const rise = best.top! - this.feetY;
    this.mantling = true;
    this.mantleTimer = 0;
    this.mantleDuration = Math.min(0.72, 0.36 + rise * 0.16);
    this.mantleStart.set(px, this.feetY, pz);
    this.mantleTarget.set(targetX, best.top!, targetZ);
    this.velocity.set(0, 0);
    this.verticalVelocity = 0;
    this.grounded = false;
    this.wishLen = 0;
    return true;
  }

  private updateMantle(dt: number) {
    this.mantleTimer += dt;
    const t = Math.min(1, this.mantleTimer / this.mantleDuration);

    // Rise first (feet lift to clear the lip), then pull forward onto the top —
    // the phases overlap so it reads as one continuous climb, not two moves.
    const up = easeOutCubic(Math.min(1, t / 0.6));
    const fwd = easeInOutCubic(Math.max(0, Math.min(1, (t - 0.32) / 0.68)));

    const x = THREE.MathUtils.lerp(this.mantleStart.x, this.mantleTarget.x, fwd);
    const z = THREE.MathUtils.lerp(this.mantleStart.z, this.mantleTarget.z, fwd);
    this.feetY = THREE.MathUtils.lerp(this.mantleStart.y, this.mantleTarget.y, up);
    this.position.set(x, z);

    // A little look-up through the middle of the climb, easing back level as we
    // crest the lip — sells the head lifting to see over the ledge.
    const lookOffset = Math.sin(t * Math.PI) * 0.14;
    const targetEyeHeight = this.prone ? PRONE_EYE_HEIGHT : EYE_HEIGHT;
    this.eyeHeight += (targetEyeHeight - this.eyeHeight) * Math.min(1, STANCE_LERP_RATE * dt);
    this.camera.position.set(x, this.feetY + this.eyeHeight, z);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch + lookOffset;

    if (t >= 1) {
      this.mantling = false;
      this.grounded = true;
      this.verticalVelocity = 0;
      this.feetY = this.mantleTarget.y;
    }
  }
}

import * as THREE from 'three';
import { buildArm } from './Arm.ts';

const ATTACK_INTERVAL = 0.36;
const WINDUP_TIME = 0.09;
const STRIKE_TIME = 0.11;
const RECOVER_TIME = 0.13;
const SWING_TOTAL = WINDUP_TIME + STRIKE_TIME + RECOVER_TIME;
const DAMAGE = 55;
const RANGE = 2.4;

const VIEWMODEL_DISTANCE = 0.95;
const VIEWMODEL_SCALE = 2.1;

// How far the viewmodel drops / tilts away while being holstered (0 = drawn).
const SWITCH_DROP = 0.55;
const SWITCH_PULL = 0.12;
const SWITCH_TILT = 0.9;

// An aggressive, committed stab. Windup cocks the knife back and up while the
// blade pitches to aim its point forward at the target; the strike then drives
// the point hard forward into the target center and holds briefly at full
// extension (the hit) before the hand retracts. It commits forward like a real
// knife kill instead of gently waving.
const REST_POSE = { pos: new THREE.Vector3(0, 0, 0), rot: new THREE.Euler(0, 0, 0) };
const WINDUP_POSE = { pos: new THREE.Vector3(0.12, 0.14, 0.15), rot: new THREE.Euler(-0.5, 0.05, 0.1) };
const STRIKE_POSE = { pos: new THREE.Vector3(-0.05, 0.0, -0.5), rot: new THREE.Euler(-1.4, 0.0, 0.0) };

function easeInOutQuad(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}
function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}
function lerpEuler(a: THREE.Euler, b: THREE.Euler, t: number): THREE.Euler {
  return new THREE.Euler(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

export interface HitResult {
  object: THREE.Object3D;
  point: THREE.Vector3;
  distance: number;
}

export class Knife {
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private viewModel: THREE.Group;
  private basePosition: THREE.Vector3;
  private cooldown = 0;
  private swinging = false;
  private swingElapsed = 0;
  private slashTrail!: THREE.Mesh;
  private switchOffset = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.raycaster.far = RANGE;

    this.viewModel = new THREE.Group();

    const blade = this.buildKnife();
    blade.rotation.set(-0.15, 0.12, 0.04);
    this.viewModel.add(blade);

    const arm = buildArm();
    blade.add(arm);

    const trailMat = new THREE.MeshBasicMaterial({
      color: 0xe8f6ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    // Sits at the blade tip (blade tip is at local y = 0.014 + bladeLength) so
    // it flashes forward with the thrust instead of sweeping to the side.
    this.slashTrail = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.09, 20), trailMat);
    this.slashTrail.position.set(0, 0.254, 0.05);
    blade.add(this.slashTrail);

    const fillLight = new THREE.PointLight(0xfff2e0, 0.85, 3);
    fillLight.position.set(0.35, 0.4, 0.5);
    this.viewModel.add(fillLight);

    const rimLight = new THREE.PointLight(0x9db4d0, 0.5, 3);
    rimLight.position.set(-0.4, 0.2, -0.4);
    this.viewModel.add(rimLight);

    this.viewModel.scale.setScalar(VIEWMODEL_SCALE);
    this.basePosition = new THREE.Vector3(0.2, -0.22, -VIEWMODEL_DISTANCE);
    this.viewModel.position.copy(this.basePosition);
    camera.add(this.viewModel);
    this.viewModel.visible = false;
  }

  private buildKnife(): THREE.Group {
    const group = new THREE.Group();

    const steel = new THREE.MeshStandardMaterial({
      color: 0xc7cbd1,
      roughness: 0.25,
      metalness: 0.9,
      emissive: 0x3a3d42,
      emissiveIntensity: 0.55,
    });
    const darkSteel = new THREE.MeshStandardMaterial({
      color: 0x35383d,
      roughness: 0.5,
      metalness: 0.8,
      emissive: 0x15161a,
      emissiveIntensity: 0.6,
    });
    const gripMat = new THREE.MeshStandardMaterial({
      color: 0x1c1d1f,
      roughness: 0.85,
      metalness: 0.1,
      emissive: 0x0e0e10,
      emissiveIntensity: 0.6,
    });

    const handleW = 0.036;
    const handleH = 0.11;
    const handleD = 0.045;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(handleW, handleH, handleD), gripMat);
    handle.position.set(0, -handleH / 2, 0.05);
    group.add(handle);

    for (let i = 0; i < 4; i++) {
      const wrap = new THREE.Mesh(new THREE.BoxGeometry(handleW + 0.004, 0.014, handleD + 0.004), darkSteel);
      wrap.position.set(0, -0.02 - i * 0.024, 0.05);
      group.add(wrap);
    }

    const pommel = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.02, 0.05), darkSteel);
    pommel.position.set(0, -handleH - 0.006, 0.05);
    group.add(pommel);

    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.016, 0.03), darkSteel);
    guard.position.set(0, 0.006, 0.05);
    group.add(guard);

    const bladeLength = 0.22;
    const bladeMesh = new THREE.Mesh(new THREE.BoxGeometry(0.028, bladeLength, 0.006), steel);
    bladeMesh.position.set(0, 0.014 + bladeLength / 2, 0.05);
    group.add(bladeMesh);

    const bladeEdge = new THREE.Mesh(new THREE.BoxGeometry(0.009, bladeLength, 0.007), steel);
    bladeEdge.position.set(0.0135, 0.014 + bladeLength / 2, 0.05);
    group.add(bladeEdge);

    return group;
  }

  get damage(): number {
    return DAMAGE;
  }

  setActive(active: boolean) {
    this.viewModel.visible = active;
  }

  // 0 = fully drawn, 1 = fully holstered (dropped and tilted off screen).
  setSwitchOffset(offset: number) {
    this.switchOffset = offset;
  }

  canSwing(): boolean {
    return this.cooldown <= 0;
  }

  swing(targets: THREE.Object3D[]): HitResult | null {
    if (!this.canSwing()) return null;
    this.cooldown = ATTACK_INTERVAL;
    this.swinging = true;
    this.swingElapsed = 0;

    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length === 0) return null;
    const hit = hits[0];
    return { object: hit.object, point: hit.point, distance: hit.distance };
  }

  update(dt: number) {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);

    if (this.swinging) {
      this.swingElapsed += dt;
      if (this.swingElapsed >= SWING_TOTAL) {
        this.swinging = false;
        this.viewModel.position.copy(this.basePosition);
        this.viewModel.rotation.set(0, 0, 0);
        this.setTrailOpacity(0);
      } else {
        this.applySwingPose(this.swingElapsed);
      }
    } else {
      // Idle: keep the viewmodel parked at rest so the holster offset below is
      // applied from a known base each frame (never accumulates).
      this.viewModel.position.copy(this.basePosition);
      this.viewModel.rotation.set(0, 0, 0);
    }

    // Holster/draw offset applied on top of the freshly-set pose each frame.
    if (this.switchOffset > 0) {
      this.viewModel.position.y -= this.switchOffset * SWITCH_DROP;
      this.viewModel.position.z -= this.switchOffset * SWITCH_PULL;
      this.viewModel.rotation.x += this.switchOffset * SWITCH_TILT;
    }
  }

  private applySwingPose(elapsed: number) {
    let pos: THREE.Vector3;
    let rot: THREE.Euler;
    let trailOpacity = 0;

    if (elapsed < WINDUP_TIME) {
      // easeInOutQuad accelerates smoothly into the wind-up instead of snapping.
      const t = easeInOutQuad(elapsed / WINDUP_TIME);
      pos = REST_POSE.pos.clone().lerp(WINDUP_POSE.pos, t);
      rot = lerpEuler(REST_POSE.rot, WINDUP_POSE.rot, t);
    } else if (elapsed < WINDUP_TIME + STRIKE_TIME) {
      // easeOutCubic makes the blade whip across fast, then decelerate.
      const t = easeOutCubic((elapsed - WINDUP_TIME) / STRIKE_TIME);
      pos = WINDUP_POSE.pos.clone().lerp(STRIKE_POSE.pos, t);
      rot = lerpEuler(WINDUP_POSE.rot, STRIKE_POSE.rot, t);
      trailOpacity = Math.sin(t * Math.PI) * 0.9;
    } else {
      const t = easeOutCubic((elapsed - WINDUP_TIME - STRIKE_TIME) / RECOVER_TIME);
      pos = STRIKE_POSE.pos.clone().lerp(REST_POSE.pos, t);
      rot = lerpEuler(STRIKE_POSE.rot, REST_POSE.rot, t);
      trailOpacity = Math.max(0, 0.2 * (1 - t));
    }

    this.viewModel.position.set(
      this.basePosition.x + pos.x,
      this.basePosition.y + pos.y,
      this.basePosition.z + pos.z,
    );
    this.viewModel.rotation.set(rot.x, rot.y, rot.z);
    this.setTrailOpacity(trailOpacity);
  }

  private setTrailOpacity(value: number) {
    (this.slashTrail.material as THREE.MeshBasicMaterial).opacity = value;
  }
}

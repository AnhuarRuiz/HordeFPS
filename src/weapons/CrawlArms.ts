import * as THREE from 'three';
import { buildForearmHand, markViewmodel } from './Hand.ts';

// Radians/sec the stroke phase advances at while crawling — one full 2*PI cycle
// is one left-right reach pair.
const CRAWL_CYCLE_SPEED = 4.2;

// Smaller than the earlier version: the old 1.8 scale on top of two long arm
// bars is what made the limbs read as huge straight slabs. A shorter single
// forearm + hand at a gentler scale reads as an actual arm.
const SCALE = 1.35;

// The pair of first-person arms shown while the player crawls prone with the
// weapon holstered: two forearms coming in from the bottom corners, hands
// planted flat on the ground ahead, dragging the body along hand over hand.
export class CrawlArms {
  private group: THREE.Group;
  private left: THREE.Group;
  private right: THREE.Group;
  private phase = 0;

  constructor(camera: THREE.Camera) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.scale.setScalar(SCALE);

    this.right = this.buildArm();
    const rightWrapper = new THREE.Group();
    rightWrapper.position.set(0.2, -0.18, -0.16);
    rightWrapper.add(this.right);
    this.group.add(rightWrapper);

    // Left arm is a true mirror via a negative-X wrapper, not a sign-flipped
    // rebuild — mirroring keeps both hands built identically and correct.
    this.left = this.buildArm();
    const leftWrapper = new THREE.Group();
    leftWrapper.scale.x = -1;
    leftWrapper.position.set(-0.2, -0.18, -0.16);
    leftWrapper.add(this.left);
    this.group.add(leftWrapper);

    // Centred lights so both mirrored hands are lit roughly equally in the dark.
    // Modest intensity so the sleeves don't blow out into pale slabs.
    const fillLight = new THREE.PointLight(0xffe9cf, 1.15, 4.5);
    fillLight.position.set(0, 0.35 / SCALE, 0.5 / SCALE);
    this.group.add(fillLight);

    const rimLight = new THREE.PointLight(0x9db4d0, 0.5, 4.5);
    rimLight.position.set(0, 0.12 / SCALE, -0.5 / SCALE);
    this.group.add(rimLight);

    markViewmodel(this.group);
    camera.add(this.group);
  }

  get visible(): boolean {
    return this.group.visible;
  }

  // One forearm+hand, pitched down so the palm rests flat on the ground ahead
  // with the forearm receding back toward the (off-screen) elbow at the frame
  // edge. Stored base rotation/position so the stroke animates relative to it.
  private buildArm(): THREE.Group {
    const arm = new THREE.Group();
    const { group } = buildForearmHand();
    arm.add(group);
    // Pitch the whole forearm down a touch so the hand sits on the ground ahead
    // rather than floating at wrist height.
    arm.rotation.set(0.32, 0.12, 0);
    arm.userData.baseRotX = arm.rotation.x;
    arm.userData.baseZ = arm.position.z;
    return arm;
  }

  setVisible(visible: boolean) {
    this.group.visible = visible;
  }

  // Phase only advances while `moving`, so the stroke freezes the instant the
  // player stops instead of playing out to a neutral pose.
  update(dt: number, moving: boolean) {
    if (moving) this.phase += CRAWL_CYCLE_SPEED * dt;

    this.applyArm(this.left, this.phase);
    this.applyArm(this.right, this.phase + Math.PI);

    // The rig settles a touch with each reach, reading as the body being hitched
    // forward a notch at a time rather than sliding smoothly.
    this.group.position.y = moving ? 0.012 * Math.sin(this.phase * 2) : 0;
  }

  // One hand's stroke: reach forward and plant (reach -> 1), then pull back
  // dragging the body over it (reach -> 0). The two hands run half a cycle apart
  // so one plants while the other recovers.
  private applyArm(arm: THREE.Group, phase: number) {
    const reach = (Math.sin(phase) + 1) / 2;
    const baseRotX = arm.userData.baseRotX as number;
    const baseZ = arm.userData.baseZ as number;

    // Planting lifts the wrist slightly and throws the hand forward; recovering
    // draws it back. Small amounts — a drag, not a big swing.
    arm.rotation.x = baseRotX - 0.14 * reach;
    arm.position.z = baseZ - 0.12 * reach;
  }
}

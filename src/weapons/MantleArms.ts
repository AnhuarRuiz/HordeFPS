import * as THREE from 'three';
import { buildForearmHand, setGrip, markViewmodel } from './Hand.ts';

const SCALE = 1.35;

// Zero 1st/2nd derivatives at both ends — the reach/pull/grip beats ride this so
// they accelerate and settle with no visible kink.
function smootherstep(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

// The pair of first-person arms shown while the player mantles up a ledge: the
// weapon is holstered (hidden by main.ts) and instead both hands reach up, grip
// the top edge with curling fingers, and haul the body up over it. One short
// forearm + a real hand each, entering from the bottom — not the long straight
// bars the first version used.
export class MantleArms {
  private group: THREE.Group;
  private left: { arm: THREE.Group; fingers: THREE.Group };
  private right: { arm: THREE.Group; fingers: THREE.Group };

  constructor(camera: THREE.Camera) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.scale.setScalar(SCALE);

    this.right = this.buildArm();
    const rightWrapper = new THREE.Group();
    rightWrapper.position.set(0.11, -0.16, -0.28);
    rightWrapper.add(this.right.arm);
    this.group.add(rightWrapper);

    this.left = this.buildArm();
    const leftWrapper = new THREE.Group();
    leftWrapper.scale.x = -1;
    leftWrapper.position.set(-0.11, -0.16, -0.28);
    leftWrapper.add(this.left.arm);
    this.group.add(leftWrapper);

    const fillLight = new THREE.PointLight(0xffe9cf, 1.15, 4.5);
    fillLight.position.set(0, 0.4 / SCALE, 0.5 / SCALE);
    this.group.add(fillLight);

    const rimLight = new THREE.PointLight(0x9db4d0, 0.5, 4.5);
    rimLight.position.set(0, 0.18 / SCALE, -0.5 / SCALE);
    this.group.add(rimLight);

    markViewmodel(this.group);
    camera.add(this.group);
  }

  get visible(): boolean {
    return this.group.visible;
  }

  // One forearm+hand, pitched UP so the fingers reach the ledge above and the
  // forearm recedes back down toward the off-screen elbow.
  private buildArm(): { arm: THREE.Group; fingers: THREE.Group } {
    const arm = new THREE.Group();
    const { group, fingers, wrist } = buildForearmHand();
    // Bend the wrist forward so that, even with the forearm angled up, the hand
    // stays palm-DOWN with the fingers hanging over the front of the ledge. This
    // is what makes the fingers close DOWNWARD (gripping over the edge) instead
    // of skyward — the whole point of the fix.
    wrist.rotation.x = -0.6;
    arm.add(group);
    // Pitched UP (positive X) so the forearm reaches the lip above; base stored
    // for the climb.
    arm.rotation.set(0.62, 0.14, 0);
    arm.userData.baseRotX = arm.rotation.x;
    return { arm, fingers };
  }

  setVisible(visible: boolean) {
    this.group.visible = visible;
  }

  // progress: 0 -> 1 across the climb, two overlapping beats:
  //   reach (0 -> ~0.4): arms swing up, fingers open, hands rise to the lip.
  //   grip+pull (~0.35 -> 1): fingers curl over the edge, then the arms pull the
  //     body up so the whole rig sinks and the hands slide down the view — the
  //     way real hands stay planted on the ledge while you rise to meet them.
  update(progress: number) {
    const p = Math.max(0, Math.min(1, progress));
    const reach = smootherstep(p / 0.4);
    const pull = smootherstep((p - 0.3) / 0.7);
    // Fingers close as the hands arrive at the lip and stay gripped through the
    // pull.
    const grip = smootherstep((p - 0.25) / 0.25);

    this.applyArm(this.left, reach, pull, grip);
    this.applyArm(this.right, reach, pull, grip);

    // Rise to grab, then sink as you haul up over the edge — but only part way,
    // so the climb ENDS with the hands still visible, planted in front of you on
    // the ledge, ready for the lowering beat to drop them out of view.
    this.group.position.y = 0.12 * reach - 0.08 * pull;
  }

  // Recovery beat played right after the climb finishes, before the weapon is
  // drawn: the hands let go (grip opens) and drop the rest of the way down out
  // of frame, so the vault settles instead of the weapon snapping back mid-pull.
  // t: 0 -> 1, continuous with the end-of-climb pose (reach = pull = 1).
  updateLower(t: number) {
    const e = t * t * (3 - 2 * t); // smoothstep
    const grip = 1 - e; // hands relax as they come off the ledge
    this.applyArm(this.left, 1, 1, grip);
    this.applyArm(this.right, 1, 1, grip);
    // Continue down from the climb-end height (0.12 - 0.08 = 0.04) out of view.
    this.group.position.y = 0.04 - 0.72 * e;
  }

  private applyArm(side: { arm: THREE.Group; fingers: THREE.Group }, reach: number, pull: number, grip: number) {
    const baseRotX = side.arm.userData.baseRotX as number;
    // Reaching swings the forearm further up to the lip (more positive pitch),
    // pulling brings it back down as the body comes up to meet the hands.
    side.arm.rotation.x = baseRotX + 0.3 * reach - 0.35 * pull;
    setGrip(side.fingers, grip);
  }
}

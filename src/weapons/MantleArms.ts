import * as THREE from 'three';
import { buildForearmHand, setGrip, makeOverlayViewmodel } from './Hand.ts';

const SCALE = 1.35;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
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

    const fillLight = new THREE.PointLight(0xfff2e0, 1.7, 4.5);
    fillLight.position.set(0, 0.4 / SCALE, 0.5 / SCALE);
    this.group.add(fillLight);

    const rimLight = new THREE.PointLight(0x9db4d0, 0.7, 4.5);
    rimLight.position.set(0, 0.18 / SCALE, -0.5 / SCALE);
    this.group.add(rimLight);

    makeOverlayViewmodel(this.group);
    camera.add(this.group);
  }

  // One forearm+hand, pitched UP so the fingers reach the ledge above and the
  // forearm recedes back down toward the off-screen elbow.
  private buildArm(): { arm: THREE.Group; fingers: THREE.Group } {
    const arm = new THREE.Group();
    const { group, fingers } = buildForearmHand();
    arm.add(group);
    // Pitched UP (positive X) so the fingertips point at the lip above; base
    // stored for the climb. (Negative X here would aim the fingers down off the
    // bottom of the frame, which is the bug the first pass shipped.)
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
    const reach = easeOutCubic(Math.min(1, p / 0.4));
    const pull = Math.max(0, Math.min(1, (p - 0.35) / 0.65));
    // Fingers close as the hands arrive at the lip and stay gripped through the
    // pull.
    const grip = Math.max(0, Math.min(1, (p - 0.28) / 0.22));

    this.applyArm(this.left, reach, pull, grip);
    this.applyArm(this.right, reach, pull, grip);

    // Rise to grab, then sink as you haul yourself up and over the edge.
    this.group.position.y = 0.1 * reach - 0.24 * pull;
  }

  private applyArm(side: { arm: THREE.Group; fingers: THREE.Group }, reach: number, pull: number, grip: number) {
    const baseRotX = side.arm.userData.baseRotX as number;
    // Reaching swings the forearm further up to the lip (more positive pitch),
    // pulling brings it back down as the body comes up to meet the hands.
    side.arm.rotation.x = baseRotX + 0.3 * reach - 0.6 * pull;
    setGrip(side.fingers, grip);
  }
}

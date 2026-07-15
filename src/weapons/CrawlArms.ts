import * as THREE from 'three';

// Same palette as the weapon-carrying arms in Arm.ts, so the limbs read as the
// same character whether they're gripping a gun or dragging it prone.
const CUFF_COLOR = 0xe2e0dc;
const SLEEVE_COLOR = 0x2f3238;

// Radians/sec the stroke phase advances at while crawling — one full 2*PI
// cycle is one left-right reach pair.
const CRAWL_CYCLE_SPEED = 4.2;

// The whole arm rig is scaled up like the weapon viewmodel (VIEWMODEL_SCALE 2.1
// in Weapon.ts) so the arms read big, fat and close to the camera the same way
// the weapon-holding arms do, instead of thin distant slabs.
const CRAWL_SCALE = 1.8;

// The upper arm's resting direction — its local -Z axis, the same "forward"
// convention buildFlashlight and the Harries hand's pointNegZAlong use —
// authored ONCE for the right-hand side and mirrored into the left via a
// wrapper's negative X scale (see CrawlArms constructor), not a hand-tuned
// sign-flipped copy: sign-flipping a compound Euler doesn't actually produce a
// mirror image (composing rotations isn't linear that way), which is why an
// earlier attempt at this looked fine on one side and paper-thin/edge-on on the
// other in every frame regardless of animation phase — a build bug, not an
// animation bug.
//
// Mostly forward/away from the camera (-Z, into the screen) with a little
// downward tilt and a little inward lean toward the centreline. Authoring the
// pose as a direction vector instead of a hand-picked Euler triple sidesteps
// the OTHER failure mode this file kept hitting: a few tenths of a radian on
// the wrong Euler axis can spin the whole box into presenting a flat,
// foreshortened face to the camera, or make two independently-tuned arms read
// as one horizontal log spanning the screen instead of two separate limbs. A
// direction vector always means exactly what it visually says.
const UPPER_DIR = new THREE.Vector3(-0.32, -0.12, -0.9).normalize();
const FORWARD = new THREE.Vector3(0, 0, -1);

// Builds one arm, always in this same fixed orientation (see UPPER_DIR above).
// Both screen instances use this identical construction; only the wrapper each
// is placed in (CrawlArms constructor) differs, mirroring the right-hand build
// into a correct left arm via a negative X scale instead of re-deriving angles.
function buildCrawlArm(): THREE.Group {
  const cuff = new THREE.MeshStandardMaterial({
    color: CUFF_COLOR,
    roughness: 0.7,
    emissive: 0x3c3b38,
    emissiveIntensity: 0.45,
  });
  const sleeve = new THREE.MeshStandardMaterial({
    color: SLEEVE_COLOR,
    roughness: 0.9,
    emissive: 0x15161a,
    emissiveIntensity: 0.5,
  });

  const shoulder = new THREE.Group();
  // Local coords — parked toward a bottom corner of its wrapper, pre-scale
  // (multiplied by CRAWL_SCALE for the actual on-screen distance). Height
  // (-0.01) was picked by projecting the fist's screen position at full reach
  // through the camera's actual FOV/aspect (see scratchpad/project.mjs) so it
  // lands just inside the bottom of the frame instead of dropping off it.
  shoulder.position.set(0, -0.01, -0.12);
  shoulder.quaternion.setFromUnitVectors(FORWARD, UPPER_DIR);
  // Stored so applyArm can layer the reach swing as a rotation around the
  // shoulder's own pre-tilt local X axis, composed UNDER this fixed base
  // quaternion — animating rotation.x directly on top of an Euler that already
  // has large yaw/roll baked in swings wildly different orientations frame to
  // frame (it briefly turns the limb edge-on to the camera mid-stroke).
  shoulder.userData.baseQuat = shoulder.quaternion.clone();
  shoulder.userData.baseZ = shoulder.position.z;

  const upperLength = 0.3;
  const upperArm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, upperLength), sleeve);
  upperArm.position.set(0, 0, -upperLength / 2);
  shoulder.add(upperArm);

  // Elbow pivot sits at the end of the upper arm so the forearm below it bends
  // from the right joint. Its rotation is a FIXED bend (never animated) so the
  // silhouette can't crumple mid-stroke — only the shoulder above it swings for
  // the reach, like a paddle stroke pivoting from one joint.
  const elbow = new THREE.Group();
  elbow.position.set(0, 0, -upperLength);
  elbow.rotation.set(-0.85, 0.15, 0);
  shoulder.add(elbow);

  const forearmLength = 0.34;
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.095, forearmLength), sleeve);
  forearm.position.set(0, 0, -forearmLength / 2);
  elbow.add(forearm);

  const cuffBand = new THREE.Mesh(new THREE.BoxGeometry(0.108, 0.103, 0.045), cuff);
  cuffBand.position.set(0, 0, -forearmLength + 0.018);
  elbow.add(cuffBand);

  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.09, 0.1), cuff);
  fist.position.set(0, -0.008, -forearmLength - 0.018);
  elbow.add(fist);

  return shoulder;
}

// The pair of viewmodel arms shown while the player crawls prone with the
// weapon holstered. Not weapon-specific — main.ts just toggles visibility and
// feeds it whether the player is currently moving.
export class CrawlArms {
  private group: THREE.Group;
  private left: THREE.Group;
  private right: THREE.Group;
  private phase = 0;

  constructor(camera: THREE.Camera) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.scale.setScalar(CRAWL_SCALE);

    // Right arm: built and positioned directly, entering from the bottom-right
    // corner per UPPER_DIR.
    this.right = buildCrawlArm();
    const rightWrapper = new THREE.Group();
    rightWrapper.position.x = 0.3;
    rightWrapper.add(this.right);
    this.group.add(rightWrapper);

    // Left arm: a TRUE mirror image via negative X scale on its wrapper, not a
    // sign-flipped rebuild — that's what made an earlier attempt paper-thin
    // and edge-on on one side (see UPPER_DIR comment).
    this.left = buildCrawlArm();
    const leftWrapper = new THREE.Group();
    leftWrapper.scale.x = -1;
    leftWrapper.position.x = -0.3;
    leftWrapper.add(this.left);
    this.group.add(leftWrapper);

    // Centred (x=0) so both mirrored arms pick up roughly equal light — an
    // off-centre light (as Arm.ts uses, fine there since it only lights one
    // arm) left one side of this symmetric pair looking lit and the other
    // nearly invisible in the dark scene.
    const fillLight = new THREE.PointLight(0xfff2e0, 1.1, 3.5);
    fillLight.position.set(0, 0.35 / CRAWL_SCALE, 0.5 / CRAWL_SCALE);
    this.group.add(fillLight);

    const rimLight = new THREE.PointLight(0x9db4d0, 0.6, 3.5);
    rimLight.position.set(0, 0.15 / CRAWL_SCALE, -0.45 / CRAWL_SCALE);
    this.group.add(rimLight);

    camera.add(this.group);
  }

  setVisible(visible: boolean) {
    this.group.visible = visible;
  }

  // Phase only advances while `moving` is true, so the stroke freezes mid-reach
  // the instant the player stops instead of playing out to a neutral pose —
  // reading as a body that stops dragging the moment it stops.
  update(dt: number, moving: boolean) {
    if (moving) this.phase += CRAWL_CYCLE_SPEED * dt;

    this.applyArm(this.left, this.phase);
    this.applyArm(this.right, this.phase + Math.PI);

    // The rig settles a touch with each reach, reading as the body being
    // hitched forward a notch at a time rather than sliding smoothly.
    this.group.position.y = moving ? 0.01 * Math.sin(this.phase * 2) : 0;
  }

  // One arm's stroke. `reach` runs 0 (pulled back toward the body, recovering)
  // -> 1 (extended forward, planted ahead). The two arms run half a cycle apart
  // so one plants while the other recovers — the alternating hand-over-hand
  // drag of a real prone crawl. The swing is a rotation around the shoulder's
  // OWN local X axis (pre-base-tilt), composed UNDER the fixed base quaternion
  // — so the diagonal "reads as a limb" orientation from buildCrawlArm is
  // preserved through the whole stroke instead of the limb rotating edge-on to
  // the camera partway through, which is what plain Euler animation did.
  private applyArm(shoulder: THREE.Group, phase: number) {
    const reach = (Math.sin(phase) + 1) / 2;
    const baseZ = shoulder.userData.baseZ as number;
    const baseQuat = shoulder.userData.baseQuat as THREE.Quaternion;

    const swing = THREE.MathUtils.lerp(0.24, -0.24, reach);
    const delta = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), swing);
    shoulder.quaternion.copy(baseQuat).multiply(delta);

    // Throws the whole arm forward on the plant and draws it back on the
    // recovery — this physical push/pull, on top of the swing, is what sells
    // the body being dragged forward a notch at a time.
    shoulder.position.z = baseZ - 0.1 * reach;
  }
}

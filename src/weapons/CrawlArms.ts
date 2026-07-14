import * as THREE from 'three';

// Same palette as the weapon-carrying arms in Arm.ts, so the limbs read as the
// same character whether they're gripping a gun or dragging it prone.
const CUFF_COLOR = 0xe2e0dc;
const SLEEVE_COLOR = 0x2f3238;

// Radians/sec the stroke phase advances at while crawling — one full 2*PI
// cycle is one left-right reach pair.
const CRAWL_CYCLE_SPEED = 4.2;

// Both arms are built identically along -Z (the same "forward" convention
// buildFlashlight and the weapon arms use) and mirrored in X per side, with a
// shoulder -> elbow hierarchy so each can be posed independently below.
function buildCrawlArm(side: 1 | -1): THREE.Group {
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
  // Distance matters a lot at this close range and a 78deg FOV: parked at the
  // same rough depth the weapon viewmodel sits at (VIEWMODEL_DISTANCE in
  // Weapon.ts is 0.95) so the boxes read as arms instead of getting stretched
  // into huge distorted wedges the way they did sitting at -0.22.
  shoulder.position.set(side * 0.34, -0.36, -0.75);

  const upperLength = 0.34;
  const upperArm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.085, upperLength), sleeve);
  upperArm.position.set(0, 0, -upperLength / 2);
  shoulder.add(upperArm);

  // Elbow pivot sits at the end of the upper arm so the forearm below it
  // bends from the right joint instead of the whole limb pivoting at the
  // shoulder.
  const elbow = new THREE.Group();
  elbow.position.set(0, 0, -upperLength);
  shoulder.add(elbow);

  const forearmLength = 0.4;
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.078, forearmLength), sleeve);
  forearm.position.set(0, 0, -forearmLength / 2);
  elbow.add(forearm);

  const cuffBand = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.084, 0.05), cuff);
  cuffBand.position.set(0, 0, -forearmLength + 0.02);
  elbow.add(cuffBand);

  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.07, 0.09), cuff);
  fist.position.set(0, -0.01, -forearmLength - 0.02);
  elbow.add(fist);

  shoulder.userData.elbow = elbow;
  return shoulder;
}

// The pair of viewmodel arms shown while the player crawls prone with the
// weapon holstered. Not weapon-specific — main.ts just toggles visibility and
// feeds it whether the player is currently moving.
export class CrawlArms {
  private group: THREE.Group;
  private left: THREE.Group;
  private right: THREE.Group;
  private leftElbow: THREE.Group;
  private rightElbow: THREE.Group;
  private phase = 0;

  constructor(camera: THREE.Camera) {
    this.group = new THREE.Group();
    this.group.visible = false;

    this.left = buildCrawlArm(-1);
    this.right = buildCrawlArm(1);
    this.leftElbow = this.left.userData.elbow as THREE.Group;
    this.rightElbow = this.right.userData.elbow as THREE.Group;
    this.group.add(this.left, this.right);

    // The weapon viewmodels carry their own fill/rim lights (see Weapon.ts) so
    // they read clearly against the game's very dark, foggy scene lighting.
    // Without the same treatment here the arms are nearly invisible — emissive
    // alone isn't enough against a near-black background.
    const fillLight = new THREE.PointLight(0xfff2e0, 0.85, 3);
    fillLight.position.set(0.35, 0.4, 0.5);
    this.group.add(fillLight);

    const rimLight = new THREE.PointLight(0x9db4d0, 0.5, 3);
    rimLight.position.set(-0.4, 0.2, -0.4);
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

    this.applyArm(this.left, this.leftElbow, this.phase);
    this.applyArm(this.right, this.rightElbow, this.phase + Math.PI);

    // The rig settles a touch with each reach, reading as the body being
    // hitched forward a notch at a time rather than sliding smoothly.
    this.group.position.y = moving ? 0.015 * Math.sin(this.phase * 2) : 0;
  }

  // reach: 0 = arm pulled back with a bent elbow near the chest, 1 = arm
  // extended forward along the ground. The elbow stays bent through the whole
  // stroke — a real crawl never locks the arm straight, it stays arched and
  // digs the forearm/elbow into the ground to drag the body along.
  private applyArm(shoulder: THREE.Group, elbow: THREE.Group, phase: number) {
    const reach = (Math.sin(phase) + 1) / 2;
    shoulder.rotation.x = THREE.MathUtils.lerp(0.32, -0.15, reach);
    elbow.rotation.x = THREE.MathUtils.lerp(-1.0, -0.45, reach);
  }
}

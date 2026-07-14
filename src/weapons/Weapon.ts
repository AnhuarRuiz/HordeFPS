import * as THREE from 'three';
import { buildArm, buildHarriesHand, buildReloadHand } from './Arm.ts';
import { playPistolShot, playReloadFinish, playReloadStart } from '../systems/Audio.ts';

const MAG_SIZE = 30;
const MAX_RESERVE = 150;
const RELOAD_TIME = 1.6;
const FIRE_INTERVAL = 0.11;
const DAMAGE = 26;
const RANGE = 60;
const RECOIL_KICK = 0.045;
const RECOIL_RECOVERY = 9;

const VIEWMODEL_DISTANCE = 0.95;
const VIEWMODEL_SCALE = 2.1;

// Aim-down-sights: viewmodel pulls in toward center/camera; lerp rate is per
// second, so this reaches full aim in ~0.15s.
const AIM_OFFSET = new THREE.Vector3(-0.2, 0.05, 0.28);
const AIM_LERP_RATE = 10;

// How far the viewmodel drops / tilts away while being holstered (0 = drawn).
// Big enough that offset 1 puts the weapon genuinely off the bottom of the
// frame. If it is still partly visible when the holster beat ends, the model
// is switched out while on screen and the animation reads as cut short.
const SWITCH_DROP = 1.6;
const SWITCH_PULL = 0.3;
const SWITCH_TILT = 1.4;
// A roll away from the body, so holstering reads as the weapon being turned
// and put down rather than just sliding straight out of frame.
const SWITCH_ROLL = 0.5;

// A reload needs both hands, so it runs as a three-beat sequence rather than
// the flashlight simply blinking out of existence:
//   stow    - the support hand lowers the flashlight out of frame (beam fades)
//   reload  - both hands work the gun; the support hand is gone, beam is dead
//   present - the hand swings the flashlight back up (beam fades back in)
// The hand's pose and the beam are both driven off one 0→1 "away" amount, so
// they can never disagree about whether the light is in hand.
type ReloadPhase = 'idle' | 'stow' | 'reload' | 'present';

const STOW_TIME = 0.32;
const PRESENT_TIME = 0.55;
const HARRIES_STOW_OFFSET = new THREE.Vector3(0.05, -0.44, 0.16);
const HARRIES_STOW_ROLL = -0.8;
const HARRIES_STOW_PITCH = 0.55;

export interface HitResult {
  object: THREE.Object3D;
  point: THREE.Vector3;
  distance: number;
}

export class Weapon {
  ammoInMag = MAG_SIZE;
  reserveAmmo = MAX_RESERVE;

  private phase: ReloadPhase = 'idle';
  private stowTimer = 0;
  private harriesAway = 0;

  private camera: THREE.PerspectiveCamera;
  private reloadTimer = 0;
  private cooldown = 0;
  private raycaster = new THREE.Raycaster();
  private viewModel: THREE.Group;
  private muzzleFlash!: THREE.Mesh;
  private muzzleLight!: THREE.PointLight;
  private muzzleFlashTimer = 0;
  private recoil = 0;
  private basePosition: THREE.Vector3;
  private slide!: THREE.Mesh;
  private slideRestZ = 0;
  private magGroup!: THREE.Group;
  private reloadHand!: THREE.Group;
  private harriesHand!: THREE.Group;
  private harriesEmitter!: THREE.Object3D;
  private harriesAnchor = new THREE.Vector3();
  private presentTimer = 0;
  private gripPivot!: THREE.Group;
  private tmpVec = new THREE.Vector3();
  private switchOffset = 0;
  private aiming = false;
  private aimAmount = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.raycaster.far = RANGE;

    this.viewModel = new THREE.Group();

    const gunScale = 0.85;
    const gun = this.buildPistol();
    gun.position.set(0, 0, 0);
    gun.rotation.set(0, 0.12, 0.04);
    gun.scale.setScalar(gunScale);
    this.viewModel.add(gun);

    // The arm rides the grip, so it inherits the gun's scale; undo it here to
    // keep the arm the size it already is while only the pistol shrinks.
    // Lifted slightly on the pistol so the support arm has room to cross
    // underneath it in the Harries hold below.
    const arm = buildArm();
    arm.scale.setScalar(1 / gunScale);
    arm.position.y += 0.05;
    // Swept back toward the shoulder instead of out to the right, so it stops
    // passing in front of the support hand — its silhouette was slicing a notch
    // across that fist and making the hand unreadable.
    arm.rotation.y -= 0.26;
    gun.add(arm);

    // Off hand that carries the magazine and racks the slide during reloads
    // (hidden otherwise). Parented to the gun so it can reach both the mag well
    // and the slide in one coordinate space.
    this.gripPivot = gun.userData.gripPivot as THREE.Group;
    const reloadHand = buildReloadHand();
    reloadHand.scale.setScalar(1 / gunScale);
    reloadHand.visible = false;
    gun.add(reloadHand);
    this.reloadHand = reloadHand;

    // Support hand in a Harries hold: parked just under and behind the grip,
    // wrist crossed in under the gun hand, flashlight aimed alongside the
    // barrel. Visible whenever the pistol isn't mid-reload.
    const harriesHand = buildHarriesHand();
    harriesHand.scale.setScalar(1 / gunScale);
    this.harriesAnchor.copy(gun.userData.harriesAnchor as THREE.Vector3);
    harriesHand.position.copy(this.harriesAnchor);
    gun.add(harriesHand);
    this.harriesHand = harriesHand;
    const harriesLight = harriesHand.userData.flashlight as THREE.Group;
    this.harriesEmitter = harriesLight.userData.emitter as THREE.Object3D;

    const fillLight = new THREE.PointLight(0xfff2e0, 0.85, 3);
    fillLight.position.set(0.35, 0.4, 0.5);
    this.viewModel.add(fillLight);

    const rimLight = new THREE.PointLight(0x9db4d0, 0.5, 3);
    rimLight.position.set(-0.4, 0.2, -0.4);
    this.viewModel.add(rimLight);

    this.viewModel.scale.setScalar(VIEWMODEL_SCALE);
    this.basePosition = new THREE.Vector3(0.2, -0.24, -VIEWMODEL_DISTANCE);
    this.viewModel.position.copy(this.basePosition);
    camera.add(this.viewModel);
  }

  private buildPistol(): THREE.Group {
    const gun = new THREE.Group();

    const steel = new THREE.MeshStandardMaterial({
      color: 0x9fa5ac,
      roughness: 0.35,
      metalness: 0.85,
      emissive: 0x2b2f34,
      emissiveIntensity: 0.6,
    });
    const polymer = new THREE.MeshStandardMaterial({
      color: 0x232529,
      roughness: 0.8,
      metalness: 0.1,
      emissive: 0x141518,
      emissiveIntensity: 0.7,
    });
    const darkSteel = new THREE.MeshStandardMaterial({
      color: 0x4a4f56,
      roughness: 0.45,
      metalness: 0.8,
      emissive: 0x1c1f23,
      emissiveIntensity: 0.6,
    });

    const frameW = 0.05;
    const frameH = 0.055;
    const frameD = 0.19;
    const frame = new THREE.Mesh(new THREE.BoxGeometry(frameW, frameH, frameD), polymer);
    gun.add(frame);
    const frameTop = frameH / 2;
    const frameBottom = -frameH / 2;
    const frameBack = frameD / 2;

    const slideW = 0.058;
    const slideH = 0.052;
    const slideD = 0.3;
    const slideY = frameTop + slideH / 2;
    const slideZ = -0.02;
    const slide = new THREE.Mesh(new THREE.BoxGeometry(slideW, slideH, slideD), steel);
    slide.position.set(0, slideY, slideZ);
    gun.add(slide);
    this.slide = slide;
    this.slideRestZ = slideZ;
    const slideTop = slideY + slideH / 2;
    const slideFront = slideZ - slideD / 2;
    const slideBack = slideZ + slideD / 2;

    for (let i = 0; i < 6; i++) {
      const z = slideBack - 0.018 - i * 0.016;
      for (const side of [-1, 1]) {
        const serration = new THREE.Mesh(new THREE.BoxGeometry(0.004, slideH * 0.72, 0.006), darkSteel);
        serration.position.set(side * (slideW / 2), slideY, z);
        gun.add(serration);
      }
    }

    const ejectionPort = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.026, 0.07), polymer);
    ejectionPort.position.set(slideW / 2 - 0.001, slideY + 0.008, slideZ - 0.05);
    gun.add(ejectionPort);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0135, 0.03, 12), darkSteel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, slideY, slideFront - 0.014);
    gun.add(barrel);

    const muzzleRing = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.004, 6, 14), darkSteel);
    muzzleRing.position.set(0, slideY, slideFront - 0.001);
    gun.add(muzzleRing);

    const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.014, 0.012), darkSteel);
    frontSight.position.set(0, slideTop + 0.007, slideFront + 0.022);
    gun.add(frontSight);

    const rearSightBase = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.016), darkSteel);
    rearSightBase.position.set(0, slideTop + 0.006, slideBack - 0.026);
    gun.add(rearSightBase);

    const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.026, 0.012), darkSteel);
    hammer.position.set(0, frameTop + 0.014, frameBack - 0.008);
    gun.add(hammer);

    const beavertail = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.014, 0.045), polymer);
    beavertail.position.set(0, frameTop - 0.004, frameBack + 0.012);
    beavertail.rotation.x = 0.35;
    gun.add(beavertail);

    const triggerGuard = new THREE.Mesh(
      new THREE.TorusGeometry(0.03, 0.006, 6, 16, Math.PI * 1.35),
      polymer,
    );
    triggerGuard.rotation.set(0, Math.PI / 2, Math.PI * 0.12);
    triggerGuard.position.set(0, frameBottom - 0.028, -0.035);
    gun.add(triggerGuard);

    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.028, 0.009), darkSteel);
    trigger.position.set(0, frameBottom - 0.019, -0.035);
    gun.add(trigger);

    const gripW = 0.05;
    const gripH = 0.135;
    const gripD = 0.062;
    const gripPivot = new THREE.Group();
    gripPivot.position.set(0, frameBottom, 0.028);
    gripPivot.rotation.x = -0.26;
    gun.add(gripPivot);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(gripW, gripH, gripD), polymer);
    grip.position.set(0, -gripH / 2, 0);
    gripPivot.add(grip);

    for (let i = 0; i < 5; i++) {
      const stipple = new THREE.Mesh(new THREE.BoxGeometry(gripW + 0.003, 0.006, 0.004), darkSteel);
      stipple.position.set(0, -0.03 - i * 0.021, -gripD / 2 + 0.002);
      gripPivot.add(stipple);
    }

    // Magazine as its own group so it can drop out and be swapped during
    // reload. Lighter steel so the drop reads against the dark grip.
    const magGroup = new THREE.Group();
    const magBody = new THREE.Mesh(new THREE.BoxGeometry(gripW - 0.004, gripH * 0.95, gripD - 0.006), steel);
    magBody.position.set(0, -gripH / 2, 0);
    magGroup.add(magBody);
    const magBase = new THREE.Mesh(new THREE.BoxGeometry(gripW + 0.008, 0.014, gripD + 0.008), darkSteel);
    magBase.position.set(0, -gripH - 0.004, 0);
    magGroup.add(magBase);
    gripPivot.add(magGroup);
    this.magGroup = magGroup;

    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffcf6b, transparent: true, opacity: 0 });
    this.muzzleFlash = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.15, 8), flashMat);
    this.muzzleFlash.rotation.x = -Math.PI / 2;
    this.muzzleFlash.position.set(0, slideY, slideFront - 0.085);
    gun.add(this.muzzleFlash);

    this.muzzleLight = new THREE.PointLight(0xffb347, 0, 4);
    this.muzzleLight.position.set(0, slideY, slideFront - 0.06);
    gun.add(this.muzzleLight);

    gun.userData.gripPivot = gripPivot;
    gun.userData.gripHeight = gripH;
    gun.userData.gripDepth = gripD;
    // Right of, and forward of, the gun hand's arm — which sprawls back toward
    // the camera from the grip and would otherwise sit directly in front of the
    // flashlight and hide it completely.
    gun.userData.harriesAnchor = new THREE.Vector3(0.27, frameBottom - 0.05, -0.1);

    return gun;
  }

  setActive(active: boolean) {
    this.viewModel.visible = active;
  }

  // 0 = fully drawn, 1 = fully holstered (dropped and tilted off screen).
  setSwitchOffset(offset: number) {
    this.switchOffset = offset;
  }

  setAiming(aiming: boolean) {
    this.aiming = aiming;
  }

  addReserveAmmo(amount: number) {
    this.reserveAmmo = Math.min(MAX_RESERVE, this.reserveAmmo + amount);
  }

  get damage(): number {
    return DAMAGE;
  }

  // True from the moment the player commits to a reload — including the beat
  // where the support hand is still putting the flashlight away — so the HUD
  // reads "reloading" and the gun can't fire for that whole window.
  get isReloading(): boolean {
    return this.phase === 'stow' || this.phase === 'reload';
  }

  // How lit the handheld flashlight should be. It's simply the inverse of how
  // far the support hand has taken it out of the Harries hold, so the beam
  // always tracks the hand that's carrying it.
  get flashlightBlend(): number {
    return 1 - this.harriesAway;
  }

  // Where the beam physically leaves the model right now, so the caller can
  // park the real SpotLight there.
  getFlashlightEmitter(out: THREE.Vector3): THREE.Vector3 {
    return this.harriesEmitter.getWorldPosition(out);
  }

  // Drawn from another weapon: the support hand has to bring the flashlight
  // back up into the Harries hold, rather than it just materializing.
  startPresent() {
    if (this.isReloading) return;
    this.phase = 'present';
    this.presentTimer = PRESENT_TIME;
    this.harriesAway = 1;
    this.updateHarriesHand();
  }

  get reloadProgress(): number {
    return this.phase === 'reload' ? 1 - this.reloadTimer / RELOAD_TIME : 0;
  }

  canFire(): boolean {
    return !this.isReloading && this.ammoInMag > 0 && this.cooldown <= 0;
  }

  tryReload() {
    if (this.isReloading || this.ammoInMag === MAG_SIZE || this.reserveAmmo === 0) return;
    // Put the flashlight away first; the reload proper starts once the support
    // hand is clear. Interrupting a present-animation shortens the stow to
    // match how far the hand had already come back, so it never pops.
    this.phase = 'stow';
    this.stowTimer = STOW_TIME * (1 - this.harriesAway);
  }

  fire(targets: THREE.Object3D[]): HitResult | null {
    if (!this.canFire()) {
      if (this.ammoInMag === 0 && !this.isReloading) this.tryReload();
      return null;
    }
    this.ammoInMag -= 1;
    this.cooldown = FIRE_INTERVAL;
    this.recoil = RECOIL_KICK * (1 - this.aimAmount * 0.5);
    this.muzzleFlashTimer = 0.05;
    playPistolShot();

    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length === 0) return null;
    const hit = hits[0];
    return { object: hit.object, point: hit.point, distance: hit.distance };
  }

  // Pistol reload driven by the off hand: it reaches in, drops the old mag and
  // seats a fresh one (carrying it the whole way), then moves up to the slide
  // and racks it, and finally pulls back out. `p` runs 0→1.
  private applyReloadPose(p: number) {
    const env = p < 0.12 ? p / 0.12 : p > 0.9 ? Math.max(0, (1 - p) / 0.1) : 1;
    // Slide-rack hump while the hand is on the slide (0.66–0.82).
    const rack = p > 0.66 && p < 0.82 ? Math.sin(((p - 0.66) / 0.16) * Math.PI) : 0;

    this.viewModel.position.set(
      this.basePosition.x - 0.04 * env,
      this.basePosition.y - 0.08 * env + 0.03 * rack,
      this.basePosition.z + 0.04 * env,
    );
    // Muzzle up and mag well rolled toward the viewer; the rack jerks it up.
    this.viewModel.rotation.set(0.45 * env - 0.12 * rack, 0.28 * env, 0.45 * env);

    // Old mag drops out (0.18–0.40); a fresh one rides back up (0.44–0.58).
    let magY = 0;
    if (p >= 0.18 && p < 0.4) magY = -0.3 * ((p - 0.18) / 0.22);
    else if (p >= 0.4 && p < 0.44) magY = -0.3;
    else if (p >= 0.44 && p < 0.58) magY = -0.3 * (1 - (p - 0.44) / 0.14);
    this.magGroup.position.y = magY;

    // Slide racks with the hand — set before we read it for the hand's grip.
    this.slide.position.z = this.slideRestZ + rack * 0.12;

    // Off-hand choreography, all in gun-local space.
    if (p > 0.1 && p < 0.9) {
      this.reloadHand.visible = true;
      // Magazine grip point: the mag's origin (in gun space) plus a wrap offset.
      this.gripPivot.updateMatrix();
      const mag = this.tmpVec.copy(this.magGroup.position).applyMatrix4(this.gripPivot.matrix);
      const mx = mag.x - 0.02;
      const my = mag.y - 0.01;
      const mz = mag.z - 0.03;
      // Slide grip point: over the slide, kept forward of the rear so the hand
      // doesn't balloon up against the camera. Tracks the rack in Z.
      const sx = this.slide.position.x;
      const sy = this.slide.position.y + 0.02;
      const sz = this.slide.position.z - 0.03;
      // Off-screen rest.
      const ox = -0.14;
      const oy = -0.34;
      const oz = 0.08;

      let hx: number;
      let hy: number;
      let hz: number;
      if (p < 0.18) {
        const t = (p - 0.1) / 0.08; // reach in to the mag
        hx = ox + (mx - ox) * t;
        hy = oy + (my - oy) * t;
        hz = oz + (mz - oz) * t;
      } else if (p < 0.58) {
        hx = mx; // carry the magazine through the swap
        hy = my;
        hz = mz;
      } else if (p < 0.66) {
        // Travel from the mag up to the slide along an arc that bows out to the
        // left and up, so the hand goes AROUND the gun instead of through it.
        const t = (p - 0.58) / 0.08;
        const cx = -0.13;
        const cy = Math.max(my, sy) + 0.06;
        const cz = (mz + sz) / 2 + 0.03;
        const u = 1 - t;
        hx = u * u * mx + 2 * u * t * cx + t * t * sx;
        hy = u * u * my + 2 * u * t * cy + t * t * sy;
        hz = u * u * mz + 2 * u * t * cz + t * t * sz;
      } else if (p < 0.82) {
        hx = sx; // grip the slide and rack it
        hy = sy;
        hz = sz;
      } else {
        const t = (p - 0.82) / 0.08; // pull back out
        hx = sx + (ox - sx) * t;
        hy = sy + (oy - sy) * t;
        hz = sz + (oz - sz) * t;
      }
      this.reloadHand.position.set(hx, hy, hz);
    } else {
      this.reloadHand.visible = false;
    }
  }

  // Advances the stow → reload → present sequence and, from it, the single
  // `harriesAway` value (0 = flashlight up in the Harries hold, 1 = fully put
  // away) that both the support hand's pose and the beam are driven from.
  private updateReloadSequence(dt: number) {
    switch (this.phase) {
      case 'stow': {
        this.stowTimer = Math.max(0, this.stowTimer - dt);
        const t = 1 - this.stowTimer / STOW_TIME;
        this.harriesAway = t * t; // eases in: the hand drops away with intent
        if (this.stowTimer <= 0) {
          this.harriesAway = 1;
          this.phase = 'reload';
          this.reloadTimer = RELOAD_TIME;
          playReloadStart();
        }
        break;
      }
      case 'reload': {
        this.harriesAway = 1;
        this.reloadTimer -= dt;
        if (this.reloadTimer <= 0) {
          const needed = MAG_SIZE - this.ammoInMag;
          const taken = Math.min(needed, this.reserveAmmo);
          this.ammoInMag += taken;
          this.reserveAmmo -= taken;
          playReloadFinish();
          this.phase = 'present';
          this.presentTimer = PRESENT_TIME;
        }
        break;
      }
      case 'present': {
        this.presentTimer = Math.max(0, this.presentTimer - dt);
        const t = 1 - this.presentTimer / PRESENT_TIME;
        this.harriesAway = Math.pow(1 - t, 3); // eases out as it settles back
        if (this.presentTimer <= 0) {
          this.harriesAway = 0;
          this.phase = 'idle';
        }
        break;
      }
      default:
        this.harriesAway = 0;
    }
  }

  // The support hand rides `harriesAway`: at 0 it's up in the Harries hold, at
  // 1 it's dropped below the frame, rolled and pitched over. It's only actually
  // hidden during the reload beat itself, so the stow and present read as the
  // hand physically taking the light down and bringing it back.
  private updateHarriesHand() {
    this.harriesHand.visible = this.phase !== 'reload';
    const away = this.harriesAway;
    this.harriesHand.position.copy(this.harriesAnchor).addScaledVector(HARRIES_STOW_OFFSET, away);
    this.harriesHand.rotation.set(HARRIES_STOW_PITCH * away, 0, HARRIES_STOW_ROLL * away);
  }

  update(dt: number) {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    this.aimAmount += ((this.aiming ? 1 : 0) - this.aimAmount) * Math.min(1, AIM_LERP_RATE * dt);

    this.updateReloadSequence(dt);
    this.updateHarriesHand();

    // Only the reload beat drives the gun into its reload pose; during the stow
    // and present beats the gun sits in its normal pose while the support hand
    // does its work.
    if (this.phase === 'reload') {
      this.applyReloadPose(1 - this.reloadTimer / RELOAD_TIME);
    } else {
      this.recoil = Math.max(0, this.recoil - RECOIL_RECOVERY * dt * this.recoil);
      this.viewModel.position.set(
        this.basePosition.x + AIM_OFFSET.x * this.aimAmount,
        this.basePosition.y + this.recoil * 0.4 + AIM_OFFSET.y * this.aimAmount,
        this.basePosition.z + this.recoil + AIM_OFFSET.z * this.aimAmount,
      );
      this.viewModel.rotation.set(0, 0, 0);
      this.magGroup.position.y = 0;
      this.slide.position.z = this.slideRestZ;
      this.reloadHand.visible = false;
    }

    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      const mat = this.muzzleFlash.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, this.muzzleFlashTimer / 0.05);
      this.muzzleLight.intensity = mat.opacity * 6;
    } else {
      this.muzzleLight.intensity = 0;
    }

    // Holster/draw offset applied on top of the freshly-set pose each frame.
    // Note this runs for negative offsets too: the draw eases slightly past rest
    // so the weapon overshoots upward and rocks back into place.
    if (this.switchOffset !== 0) {
      this.viewModel.position.y -= this.switchOffset * SWITCH_DROP;
      this.viewModel.position.z -= this.switchOffset * SWITCH_PULL;
      this.viewModel.rotation.x += this.switchOffset * SWITCH_TILT;
      this.viewModel.rotation.z += this.switchOffset * SWITCH_ROLL;
    }
  }
}

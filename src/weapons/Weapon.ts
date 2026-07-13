import * as THREE from 'three';
import { buildArm } from './Arm.ts';

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

export interface HitResult {
  object: THREE.Object3D;
  point: THREE.Vector3;
  distance: number;
}

export class Weapon {
  ammoInMag = MAG_SIZE;
  reserveAmmo = MAX_RESERVE;
  isReloading = false;

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
    const arm = buildArm();
    arm.scale.setScalar(1 / gunScale);
    gun.add(arm);

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

    return gun;
  }

  setActive(active: boolean) {
    this.viewModel.visible = active;
  }

  get damage(): number {
    return DAMAGE;
  }

  get reloadProgress(): number {
    return this.isReloading ? 1 - this.reloadTimer / RELOAD_TIME : 0;
  }

  canFire(): boolean {
    return !this.isReloading && this.ammoInMag > 0 && this.cooldown <= 0;
  }

  tryReload() {
    if (this.isReloading || this.ammoInMag === MAG_SIZE || this.reserveAmmo === 0) return;
    this.isReloading = true;
    this.reloadTimer = RELOAD_TIME;
  }

  fire(targets: THREE.Object3D[]): HitResult | null {
    if (!this.canFire()) {
      if (this.ammoInMag === 0 && !this.isReloading) this.tryReload();
      return null;
    }
    this.ammoInMag -= 1;
    this.cooldown = FIRE_INTERVAL;
    this.recoil = RECOIL_KICK;
    this.muzzleFlashTimer = 0.05;

    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length === 0) return null;
    const hit = hits[0];
    return { object: hit.object, point: hit.point, distance: hit.distance };
  }

  // Pistol reload, two visible beats: (1) tilt down and swap the magazine,
  // (2) tug the gun up while the slide racks hard (the slide sits on top, so
  // it reads clearly even though the hand hides the mag). `p` runs 0→1.
  private applyReloadPose(p: number) {
    const env = p < 0.12 ? p / 0.12 : p > 0.88 ? Math.max(0, (1 - p) / 0.12) : 1;
    // Rack beat: a 0→1→0 hump over 0.60–0.82.
    const rack = p > 0.6 && p < 0.82 ? Math.sin(((p - 0.6) / 0.22) * Math.PI) : 0;

    this.viewModel.position.set(
      this.basePosition.x - 0.04 * env,
      this.basePosition.y - 0.08 * env + 0.035 * rack,
      this.basePosition.z + 0.04 * env,
    );
    // Muzzle up and mag well rolled toward the viewer; the rack jerks it up.
    this.viewModel.rotation.set(0.45 * env - 0.18 * rack, 0.28 * env, 0.45 * env);

    // Old mag drops out (0.18–0.40); a fresh one rides back up (0.44–0.60).
    let magY = 0;
    if (p >= 0.18 && p < 0.4) magY = -0.3 * ((p - 0.18) / 0.22);
    else if (p >= 0.4 && p < 0.44) magY = -0.3;
    else if (p >= 0.44 && p < 0.6) magY = -0.3 * (1 - (p - 0.44) / 0.16);
    this.magGroup.position.y = magY;

    // Slide racks with the second beat: pulled back, then snaps forward.
    this.slide.position.z = this.slideRestZ + rack * 0.11;
  }

  update(dt: number) {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);

    if (this.isReloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const needed = MAG_SIZE - this.ammoInMag;
        const taken = Math.min(needed, this.reserveAmmo);
        this.ammoInMag += taken;
        this.reserveAmmo -= taken;
        this.isReloading = false;
      }
    }

    if (this.isReloading) {
      this.applyReloadPose(1 - this.reloadTimer / RELOAD_TIME);
    } else {
      this.recoil = Math.max(0, this.recoil - RECOIL_RECOVERY * dt * this.recoil);
      this.viewModel.position.set(
        this.basePosition.x,
        this.basePosition.y + this.recoil * 0.4,
        this.basePosition.z + this.recoil,
      );
      this.viewModel.rotation.set(0, 0, 0);
      this.magGroup.position.y = 0;
      this.slide.position.z = this.slideRestZ;
    }

    if (this.muzzleFlashTimer > 0) {
      this.muzzleFlashTimer -= dt;
      const mat = this.muzzleFlash.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, this.muzzleFlashTimer / 0.05);
      this.muzzleLight.intensity = mat.opacity * 6;
    } else {
      this.muzzleLight.intensity = 0;
    }
  }
}

import * as THREE from 'three';
import { buildArm, buildSupportArm } from './Arm.ts';

// M4A1: full-auto carbine. Higher rate of fire and range than the pistol, but
// slightly less damage per round and a longer reload.
const MAG_SIZE = 30;
const MAX_RESERVE = 210;
const RELOAD_TIME = 2.1;
const FIRE_INTERVAL = 0.075;
const DAMAGE = 22;
const RANGE = 90;
const RECOIL_KICK = 0.03;
const RECOIL_RECOVERY = 10;

const VIEWMODEL_DISTANCE = 0.95;
const VIEWMODEL_SCALE = 2.1;

export interface HitResult {
  object: THREE.Object3D;
  point: THREE.Vector3;
  distance: number;
}

export class Rifle {
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
  private magPivot!: THREE.Group;
  private magRestY = 0;
  private chargingHandle!: THREE.Mesh;
  private chargeRestZ = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.raycaster.far = RANGE;

    this.viewModel = new THREE.Group();

    const gunScale = 0.78;
    const gun = this.buildRifle();
    gun.position.set(0, 0, 0);
    gun.rotation.set(0, 0.1, 0.03);
    gun.scale.setScalar(gunScale);
    this.viewModel.add(gun);

    // Both arms ride the gun, so they inherit its scale; undo it here to keep
    // the arms their intended size while only the rifle shrinks.
    const triggerArm = buildArm();
    triggerArm.scale.setScalar(1 / gunScale);
    (gun.userData.gripPivot as THREE.Group).add(triggerArm);

    // Support (left) hand gripping the handguard, mounted at its anchor point.
    const supportMount = new THREE.Group();
    supportMount.position.copy(gun.userData.supportAnchor as THREE.Vector3);
    supportMount.scale.setScalar(1 / gunScale);
    supportMount.add(buildSupportArm());
    gun.add(supportMount);

    const fillLight = new THREE.PointLight(0xfff2e0, 0.85, 3);
    fillLight.position.set(0.35, 0.4, 0.5);
    this.viewModel.add(fillLight);

    const rimLight = new THREE.PointLight(0x9db4d0, 0.5, 3);
    rimLight.position.set(-0.4, 0.2, -0.4);
    this.viewModel.add(rimLight);

    this.viewModel.scale.setScalar(VIEWMODEL_SCALE);
    this.basePosition = new THREE.Vector3(0.24, -0.26, -VIEWMODEL_DISTANCE);
    this.viewModel.position.copy(this.basePosition);
    camera.add(this.viewModel);
    this.viewModel.visible = false;
  }

  private buildRifle(): THREE.Group {
    const gun = new THREE.Group();

    const receiverMat = new THREE.MeshStandardMaterial({
      color: 0x2b2d31,
      roughness: 0.6,
      metalness: 0.55,
      emissive: 0x151619,
      emissiveIntensity: 0.6,
    });
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x1c1d20,
      roughness: 0.7,
      metalness: 0.5,
      emissive: 0x101113,
      emissiveIntensity: 0.6,
    });
    const steel = new THREE.MeshStandardMaterial({
      color: 0x4a4f56,
      roughness: 0.4,
      metalness: 0.85,
      emissive: 0x1c1f23,
      emissiveIntensity: 0.55,
    });
    const polymer = new THREE.MeshStandardMaterial({
      color: 0x222428,
      roughness: 0.85,
      metalness: 0.1,
      emissive: 0x121317,
      emissiveIntensity: 0.65,
    });

    // Upper + lower receiver: the main body the sights and barrel bolt onto.
    const receiverW = 0.05;
    const receiverH = 0.062;
    const receiverD = 0.24;
    const receiverZ = 0.02;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(receiverW, receiverH, receiverD), receiverMat);
    receiver.position.set(0, 0, receiverZ);
    gun.add(receiver);
    const receiverTop = receiverH / 2;
    const receiverFront = receiverZ - receiverD / 2;
    const receiverBack = receiverZ + receiverD / 2;

    // Magazine well + curved STANAG mag hanging down and angled forward.
    const magWell = new THREE.Mesh(new THREE.BoxGeometry(receiverW + 0.004, 0.05, 0.05), receiverMat);
    magWell.position.set(0, -receiverH / 2 - 0.02, receiverZ - 0.03);
    gun.add(magWell);

    const magPivot = new THREE.Group();
    magPivot.position.set(0, -receiverH / 2 - 0.03, receiverZ - 0.03);
    magPivot.rotation.x = 0.32;
    gun.add(magPivot);
    this.magPivot = magPivot;
    this.magRestY = magPivot.position.y;
    const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.16, 0.046), polymer);
    magazine.position.set(0, -0.08, 0);
    magPivot.add(magazine);
    const magBase = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.014, 0.052), railMat);
    magBase.position.set(0, -0.164, 0);
    magPivot.add(magBase);

    // Picatinny top rail with a row of ridges.
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.014, receiverD - 0.02), railMat);
    rail.position.set(0, receiverTop + 0.007, receiverZ);
    gun.add(rail);
    for (let i = 0; i < 10; i++) {
      const notch = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.005, 0.006), receiverMat);
      notch.position.set(0, receiverTop + 0.016, receiverBack - 0.03 - i * 0.02);
      gun.add(notch);
    }

    // Removable carry-handle rear sight — the M4's signature top profile.
    const carryHandle = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.03, 0.05), receiverMat);
    carryHandle.position.set(0, receiverTop + 0.032, receiverBack - 0.03);
    gun.add(carryHandle);
    const rearAperture = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.003, 6, 12), steel);
    rearAperture.position.set(0, receiverTop + 0.036, receiverBack - 0.05);
    gun.add(rearAperture);

    // Charging handle nub at the rear.
    const chargingHandle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.014, 0.02), steel);
    chargingHandle.position.set(0, receiverTop + 0.004, receiverBack + 0.008);
    gun.add(chargingHandle);
    this.chargingHandle = chargingHandle;
    this.chargeRestZ = receiverBack + 0.008;

    // Forward assist + ejection port bump on the right side.
    const forwardAssist = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.016, 10), steel);
    forwardAssist.rotation.z = Math.PI / 2;
    forwardAssist.position.set(receiverW / 2 + 0.005, 0.006, receiverBack - 0.05);
    gun.add(forwardAssist);

    // Round handguard/rail out front, with a couple of vent ports.
    const handguardLen = 0.26;
    const handguardZ = receiverFront - handguardLen / 2;
    const handguard = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.03, handguardLen, 14), railMat);
    handguard.rotation.x = Math.PI / 2;
    handguard.position.set(0, 0, handguardZ);
    gun.add(handguard);
    for (let i = 0; i < 3; i++) {
      const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 8), receiverMat);
      vent.rotation.z = Math.PI / 2;
      vent.position.set(0, 0.006, handguardZ + 0.02 - i * 0.05);
      gun.add(vent);
    }

    // Top rail continues over the handguard.
    const handguardRail = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.01, handguardLen), railMat);
    handguardRail.position.set(0, 0.036, handguardZ);
    gun.add(handguardRail);

    // Barrel poking past the handguard, front sight tower (gas block), and a
    // birdcage flash hider at the muzzle.
    const handguardFront = handguardZ - handguardLen / 2;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.12, 12), steel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, handguardFront - 0.06);
    gun.add(barrel);

    const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.05, 0.026), receiverMat);
    frontSight.position.set(0, 0.03, handguardFront - 0.02);
    gun.add(frontSight);
    const frontPost = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.02, 6), steel);
    frontPost.position.set(0, 0.058, handguardFront - 0.02);
    gun.add(frontPost);

    const barrelFront = handguardFront - 0.12;
    const flashHider = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.015, 0.05, 12), steel);
    flashHider.rotation.x = Math.PI / 2;
    flashHider.position.set(0, 0, barrelFront - 0.02);
    gun.add(flashHider);

    // Trigger guard + trigger.
    const triggerGuard = new THREE.Mesh(
      new THREE.TorusGeometry(0.028, 0.005, 6, 16, Math.PI * 1.3),
      polymer,
    );
    triggerGuard.rotation.set(0, Math.PI / 2, Math.PI * 0.1);
    triggerGuard.position.set(0, -receiverH / 2 - 0.026, receiverZ + 0.05);
    gun.add(triggerGuard);
    const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.024, 0.008), steel);
    trigger.position.set(0, -receiverH / 2 - 0.018, receiverZ + 0.05);
    gun.add(trigger);

    // Angled pistol grip; the arm anchors to this pivot so it tracks recoil.
    const gripPivot = new THREE.Group();
    gripPivot.position.set(0, -receiverH / 2, receiverZ + 0.075);
    gripPivot.rotation.x = -0.28;
    gun.add(gripPivot);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.12, 0.05), polymer);
    grip.position.set(0, -0.06, 0);
    gripPivot.add(grip);
    for (let i = 0; i < 4; i++) {
      const groove = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.005, 0.004), railMat);
      groove.position.set(0, -0.03 - i * 0.022, -0.025);
      gripPivot.add(groove);
    }

    // Collapsible buttstock stub reaching back toward the shoulder.
    const bufferTube = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 12), receiverMat);
    bufferTube.rotation.x = Math.PI / 2;
    bufferTube.position.set(0, 0.006, receiverBack + 0.05);
    gun.add(bufferTube);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.09), polymer);
    stock.position.set(0, 0, receiverBack + 0.1);
    gun.add(stock);

    // Muzzle flash + light live at the flash hider.
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffcf6b, transparent: true, opacity: 0 });
    this.muzzleFlash = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.18, 8), flashMat);
    this.muzzleFlash.rotation.x = -Math.PI / 2;
    this.muzzleFlash.position.set(0, 0, barrelFront - 0.11);
    gun.add(this.muzzleFlash);

    this.muzzleLight = new THREE.PointLight(0xffb347, 0, 4);
    this.muzzleLight.position.set(0, 0, barrelFront - 0.08);
    gun.add(this.muzzleLight);

    gun.userData.gripPivot = gripPivot;
    // Where the support hand wraps the handguard (its underside, mid-length).
    gun.userData.supportAnchor = new THREE.Vector3(0, -0.028, handguardZ + 0.02);

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

  // Rifle reload, two visible beats: (1) cant the rifle left and drop the
  // STANAG mag straight out for a fresh one, (2) tug it back while yanking the
  // charging handle. Bigger, two-handed feel — distinct from the pistol. `p`
  // runs 0→1.
  private applyReloadPose(p: number) {
    const env = p < 0.12 ? p / 0.12 : p > 0.88 ? Math.max(0, (1 - p) / 0.12) : 1;
    // Charging-handle beat: a 0→1→0 hump over 0.62–0.86.
    const charge = p > 0.62 && p < 0.86 ? Math.sin(((p - 0.62) / 0.24) * Math.PI) : 0;

    this.viewModel.position.set(
      this.basePosition.x + 0.03 * env,
      this.basePosition.y - 0.1 * env + 0.03 * charge,
      this.basePosition.z + 0.05 * env - 0.03 * charge,
    );
    // Muzzle up, canted left; the charge tug rocks it back briefly.
    this.viewModel.rotation.set(0.4 * env - 0.12 * charge, -0.3 * env, -0.38 * env);

    // Straight mag swap: old mag drops (0.18–0.40), fresh one up (0.44–0.58).
    let magY = 0;
    if (p >= 0.18 && p < 0.4) magY = -0.26 * ((p - 0.18) / 0.22);
    else if (p >= 0.4 && p < 0.44) magY = -0.26;
    else if (p >= 0.44 && p < 0.58) magY = -0.26 * (1 - (p - 0.44) / 0.14);
    this.magPivot.position.y = this.magRestY + magY;

    // Charging handle yanked back and released with the second beat.
    this.chargingHandle.position.z = this.chargeRestZ + charge * 0.09;
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
      this.magPivot.position.y = this.magRestY;
      this.chargingHandle.position.z = this.chargeRestZ;
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

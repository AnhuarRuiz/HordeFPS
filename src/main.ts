import * as THREE from 'three';
import './style.css';
import { buildArena } from './world/Arena.ts';
import { FirstPersonController } from './player/FirstPersonController.ts';
import { MobileControls, isMobileDevice } from './player/MobileControls.ts';
import { Weapon } from './weapons/Weapon.ts';
import { Rifle } from './weapons/Rifle.ts';
import { Knife } from './weapons/Knife.ts';
import { WaveManager } from './systems/WaveManager.ts';
import { BloodEffects } from './systems/BloodEffects.ts';
import { Hud, type ShopItem } from './ui/Hud.ts';
import type { Zombie, ZombieKind } from './entities/Zombie.ts';
import { playDenied, playImpact, playPlayerHurt, playPurchase, playZombieHit, unlockAudio } from './systems/Audio.ts';

const PLAYER_MAX_HEALTH_START = 100;
const HEADSHOT_MULTIPLIER = 2.5;
const BASE_FOV = 78;
const AIM_FOV = 62;
const FOV_LERP_RATE = 10;

const KILL_REWARD: Record<ZombieKind, number> = { shambler: 10, runner: 14, brute: 35 };

const SHOP_ITEMS: ShopItem[] = [
  { key: '4', label: 'Recargar munición', price: 40 },
  { key: '5', label: 'Botiquín (+50 HP)', price: 35 },
  { key: '6', label: '+20 HP máxima', price: 120 },
];

const appEl = document.querySelector<HTMLDivElement>('#app')!;
const mobile = isMobileDevice();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030304);
// Short, oppressive fog — Silent Hill style, where the flashlight cone is
// nearly the only thing cutting through the dark.
scene.fog = new THREE.Fog(0x030304, 3.5, 15);

const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 100);
scene.add(camera);

// Handheld flashlight: light only, no modeled housing — it rides where the
// weapon sits so the beam reads as coming from the gun. The target shares the
// light's x/y offset (just much farther in z) so the cone runs parallel to
// the camera's forward axis instead of angling in toward center — it points
// straight ahead, exactly where the crosshair is looking.
const FLASHLIGHT_INTENSITY = 110;
const flashlight = new THREE.SpotLight(0xfff2d0, FLASHLIGHT_INTENSITY, 24, THREE.MathUtils.degToRad(27), 0.5, 1.7);
// Sits just past the modeled flashlight's lens (measured in camera space), and
// the target shares its x/y so the cone runs parallel to the camera's forward
// axis — straight down the barrel, exactly where the crosshair is looking.
flashlight.position.set(0.55, -0.45, -1.8);
camera.add(flashlight);
const flashlightTarget = new THREE.Object3D();
flashlightTarget.position.set(0.55, -0.45, -8);
camera.add(flashlightTarget);
flashlight.target = flashlightTarget;

let flashlightOn = true;
function setFlashlight(on: boolean) {
  flashlightOn = on;
  flashlight.visible = on;
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
appEl.appendChild(renderer.domElement);

// Mobile browsers resize the visual viewport (not window.innerWidth/Height)
// when the address bar shows/hides, which previously left a stale gap at the
// top of the canvas. visualViewport tracks the actual visible area.
function syncViewportSize() {
  const width = window.visualViewport?.width ?? window.innerWidth;
  const height = window.visualViewport?.height ?? window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  window.scrollTo(0, 0);
}
syncViewportSize();
window.visualViewport?.addEventListener('resize', syncViewportSize);
window.visualViewport?.addEventListener('scroll', syncViewportSize);

const arena = buildArena();
scene.add(arena.group);

const hud = new Hud(appEl);
hud.setShopItems(SHOP_ITEMS);
if (mobile) {
  hud.setOverlayInstructions(
    'Joystick mover · Arrastra para mirar · Botón rojo dispara y apunta · Toca un arma para cambiar',
  );
  document.body.classList.add('mobile-layout');
}

let playerHealth = PLAYER_MAX_HEALTH_START;
let playerMaxHealth = PLAYER_MAX_HEALTH_START;
let money = 0;
let gameOver = false;

const controller = new FirstPersonController(
  camera,
  renderer.domElement,
  arena.collisionBoxes,
  arena.bounds,
  arena.playerStart,
  (locked) => {
    if (!locked) {
      isMouseDown = false;
      pistolTriggerPressed = false;
      aiming = false;
      if (!gameOver && !mobile) hud.showOverlay('PAUSADO', 'Click para continuar');
    }
  },
);

const weapon = new Weapon(camera);
const rifle = new Rifle(camera);
const knife = new Knife(camera);
const bloodFx = new BloodEffects(scene);
const waveManager = new WaveManager(scene, arena.spawnPoints, arena.collisionBoxes, (kind, position) => {
  money += KILL_REWARD[kind];
  bloodFx.spawnPool(position);
});

type WeaponSlot = 'pistol' | 'rifle' | 'knife';
let activeSlot: WeaponSlot = 'pistol';

interface Switchable {
  setActive(active: boolean): void;
  setSwitchOffset(offset: number): void;
}
function weaponForSlot(slot: WeaponSlot): Switchable {
  return slot === 'pistol' ? weapon : slot === 'rifle' ? rifle : knife;
}

function setActiveSlot(slot: WeaponSlot) {
  activeSlot = slot;
  weapon.setActive(slot === 'pistol');
  rifle.setActive(slot === 'rifle');
  knife.setActive(slot === 'knife');
}
setActiveSlot('pistol');

// Weapon switch, as a visible three-beat gesture rather than a blink:
//   holster - the current weapon is put away, dropping and rolling off screen
//   empty   - a short beat with nothing in hand, which sells the hand-off
//   draw    - the new weapon is pulled up into view and settles
// setSwitchOffset() takes 1 = fully stowed, 0 = at rest; the draw eases past 0
// slightly so the weapon overshoots and rocks back instead of stopping dead.
const HOLSTER_TIME = 0.45;
const EMPTY_TIME = 0.16;
const DRAW_TIME = 0.6;

type SwitchPhase = 'holster' | 'empty' | 'draw';
let switching = false;
let switchPhase: SwitchPhase = 'holster';
let switchTimer = 0;
let switchTo: WeaponSlot = 'pistol';

// Accelerates away — the weapon is pushed down out of frame with intent.
function easeInQuad(t: number): number {
  return t * t;
}

// Comes up fast, overshoots a touch, then settles back to rest.
function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function requestSwitch(slot: WeaponSlot) {
  if (switching || slot === activeSlot) return;
  switching = true;
  switchPhase = 'holster';
  switchTimer = 0;
  switchTo = slot;
}

function updateSwitch(dt: number) {
  if (!switching) return;
  switchTimer += dt;

  if (switchPhase === 'holster') {
    const t = Math.min(1, switchTimer / HOLSTER_TIME);
    weaponForSlot(activeSlot).setSwitchOffset(easeInQuad(t));
    if (t >= 1) {
      // Stowed: hide the old weapon and swap in the new one, still off screen.
      weaponForSlot(activeSlot).setActive(false);
      activeSlot = switchTo;
      weaponForSlot(activeSlot).setActive(true);
      weaponForSlot(activeSlot).setSwitchOffset(1);
      mobileControls?.setActiveWeapon(activeSlot);
      switchPhase = 'empty';
      switchTimer = 0;
    }
  } else if (switchPhase === 'empty') {
    if (switchTimer >= EMPTY_TIME) {
      onWeaponDrawn(activeSlot);
      switchPhase = 'draw';
      switchTimer = 0;
    }
  } else {
    const t = Math.min(1, switchTimer / DRAW_TIME);
    weaponForSlot(activeSlot).setSwitchOffset(1 - easeOutBack(t));
    if (t >= 1) {
      weaponForSlot(activeSlot).setSwitchOffset(0);
      switching = false;
    }
  }
}

// The player carries one flashlight, so drawing a weapon means moving it: the
// pistol brings it back up into the Harries hold, the rifle clamps it onto its
// side rail. Both animations kill the beam until the light is settled.
function onWeaponDrawn(slot: WeaponSlot) {
  if (slot === 'pistol') weapon.startPresent();
  else if (slot === 'rifle') rifle.startMount();
}

let isMouseDown = false;
// Semi-auto edge trigger: the pistol fires once per press, not continuously.
let pistolTriggerPressed = false;
let aiming = false;

function startFiring() {
  isMouseDown = true;
  pistolTriggerPressed = true;
}
function stopFiring() {
  isMouseDown = false;
}

function attemptPurchase(key: string) {
  if (waveManager.state !== 'intermission' || gameOver) return;
  const item = SHOP_ITEMS.find((i) => i.key === key);
  if (!item || money < item.price) {
    playDenied();
    return;
  }
  money -= item.price;
  if (key === '4') {
    weapon.addReserveAmmo(999);
    rifle.addReserveAmmo(999);
  } else if (key === '5') {
    playerHealth = Math.min(playerMaxHealth, playerHealth + 50);
  } else if (key === '6') {
    playerMaxHealth += 20;
    playerHealth = Math.min(playerMaxHealth, playerHealth + 20);
  }
  hud.setMoney(money);
  playPurchase();
}

const mobileControls = mobile
  ? new MobileControls(appEl, {
      onMove: (x, z) => controller.setTouchMove(x, z),
      onLook: (dx, dy) => controller.addLookDelta(dx, dy),
      onFireStart: () => startFiring(),
      onFireEnd: () => stopFiring(),
      onJumpStart: () => controller.press('Space'),
      onJumpEnd: () => controller.release('Space'),
      onReload: () => {
        if (activeSlot === 'pistol') weapon.tryReload();
        else if (activeSlot === 'rifle') rifle.tryReload();
      },
      onSelectWeapon: (slot) => requestSwitch(slot),
      onBuy: (key) => attemptPurchase(key),
    })
  : null;
mobileControls?.setActiveWeapon(activeSlot);

hud.onOverlayClick(() => {
  unlockAudio();
  if (gameOver) {
    window.location.reload();
    return;
  }
  hud.hideOverlay();
  if (mobile) {
    controller.enableTouch();
    mobileControls?.setVisible(true);
  } else {
    controller.lock();
  }
});

renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 0) startFiring();
  if (e.button === 2) aiming = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) stopFiring();
  if (e.button === 2) aiming = false;
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') {
    if (activeSlot === 'pistol') weapon.tryReload();
    else if (activeSlot === 'rifle') rifle.tryReload();
  }
  if (e.code === 'Digit1') requestSwitch('pistol');
  if (e.code === 'Digit2') requestSwitch('rifle');
  if (e.code === 'Digit3') requestSwitch('knife');
  if (e.code === 'Digit4') attemptPurchase('4');
  if (e.code === 'Digit5') attemptPurchase('5');
  if (e.code === 'Digit6') attemptPurchase('6');
  if (e.code === 'KeyF') setFlashlight(!flashlightOn);
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', syncViewportSize);
window.addEventListener('orientationchange', syncViewportSize);

function endGame() {
  gameOver = true;
  isMouseDown = false;
  pistolTriggerPressed = false;
  aiming = false;
  document.exitPointerLock();
  mobileControls?.setVisible(false);
  hud.hideShop();
  mobileControls?.setShopVisible(false);
  hud.showOverlay('HAS MUERTO', `Sobreviviste hasta la oleada ${waveManager.waveNumber}. Click para reintentar.`);
}

let shopVisible = false;

// Scratch vector for relocating the SpotLight onto the flashlight each frame.
const tmpLightPos = new THREE.Vector3();

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  arena.updateMist(clock.elapsedTime);

  if (controller.locked && !gameOver) {
    controller.update(dt);
    updateSwitch(dt);

    const wantAim = aiming && !switching && activeSlot !== 'knife';
    weapon.setAiming(wantAim && activeSlot === 'pistol');
    rifle.setAiming(wantAim && activeSlot === 'rifle');
    controller.setAiming(wantAim);
    const targetFov = wantAim ? AIM_FOV : BASE_FOV;
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, FOV_LERP_RATE * dt);
      camera.updateProjectionMatrix();
    }

    if (!switching) {
      const targets: THREE.Object3D[] = [...waveManager.raycastTargets, ...arena.solidMeshes];
      let hit: { object: THREE.Object3D; point: THREE.Vector3; distance: number } | null = null;
      let damage = 0;
      if (activeSlot === 'pistol' && pistolTriggerPressed) {
        pistolTriggerPressed = false;
        hit = weapon.fire(targets);
        damage = weapon.damage;
      } else if (activeSlot === 'rifle' && isMouseDown) {
        hit = rifle.fire(targets);
        damage = rifle.damage;
      } else if (activeSlot === 'knife' && isMouseDown) {
        hit = knife.swing(targets);
        damage = knife.damage;
      }
      if (hit) {
        const zombie = hit.object.userData.zombieRef as Zombie | undefined;
        if (zombie) {
          const isHeadshot = hit.object.userData.zone === 'head';
          zombie.takeDamage(damage * (isHeadshot ? HEADSHOT_MULTIPLIER : 1));
          zombie.flashHit(isHeadshot);
          hud.showHitmarker(isHeadshot);
          playZombieHit(hit.distance, isHeadshot);
          bloodFx.spawnHit(hit.point, isHeadshot);
        } else {
          playImpact();
        }
      }
    }
    weapon.update(dt);
    rifle.update(dt);
    knife.update(dt);
    bloodFx.update(dt);

    // Park the SpotLight on whichever model is currently carrying the
    // flashlight — the pistol's support hand or the rifle's side rail — and
    // aim it parallel to the camera's forward axis from there. The knife holds
    // no light, so it just leaves the beam where it was.
    let beam = 1;
    if (activeSlot === 'pistol') {
      beam = weapon.flashlightBlend;
      weapon.getFlashlightEmitter(tmpLightPos);
    } else if (activeSlot === 'rifle') {
      beam = rifle.flashlightBlend;
      rifle.getFlashlightEmitter(tmpLightPos);
    }
    if (activeSlot !== 'knife') {
      camera.worldToLocal(tmpLightPos);
      flashlight.position.copy(tmpLightPos);
      flashlightTarget.position.set(tmpLightPos.x, tmpLightPos.y, tmpLightPos.z - 6);
    }
    flashlight.intensity = FLASHLIGHT_INTENSITY * beam;

    const { damageToPlayer } = waveManager.update(dt, camera.position);
    if (damageToPlayer > 0) {
      playerHealth = Math.max(0, playerHealth - damageToPlayer);
      hud.flashHit();
      playPlayerHurt();
      if (playerHealth <= 0 && !gameOver) endGame();
    }

    hud.setHealth(playerHealth, playerMaxHealth);
    hud.setMoney(money);
    if (activeSlot === 'pistol') {
      hud.setAmmo(weapon.ammoInMag, weapon.reserveAmmo, weapon.isReloading);
    } else if (activeSlot === 'rifle') {
      hud.setAmmo(rifle.ammoInMag, rifle.reserveAmmo, rifle.isReloading);
    } else {
      hud.showMelee();
    }
    hud.setWaveInfo(waveManager.waveNumber, waveManager.zombiesRemaining, waveManager.state, waveManager.intermissionRemaining);

    const wantShop = waveManager.state === 'intermission';
    if (wantShop !== shopVisible) {
      shopVisible = wantShop;
      if (shopVisible) {
        hud.showShop();
        mobileControls?.setShopVisible(true);
      } else {
        hud.hideShop();
        mobileControls?.setShopVisible(false);
      }
    }
    if (shopVisible) {
      hud.updateShop(money, waveManager.intermissionRemaining, (key) => {
        const item = SHOP_ITEMS.find((i) => i.key === key);
        return !!item && money >= item.price;
      });
    }
  }

  renderer.render(scene, camera);
}

animate();

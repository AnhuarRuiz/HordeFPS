import * as THREE from 'three';
import './style.css';
import { buildArena } from './world/Arena.ts';
import { FirstPersonController } from './player/FirstPersonController.ts';
import { MobileControls, isMobileDevice } from './player/MobileControls.ts';
import { Weapon } from './weapons/Weapon.ts';
import { Rifle } from './weapons/Rifle.ts';
import { Knife } from './weapons/Knife.ts';
import { WaveManager } from './systems/WaveManager.ts';
import { Hud } from './ui/Hud.ts';
import type { Zombie } from './entities/Zombie.ts';

const PLAYER_MAX_HEALTH = 100;

const appEl = document.querySelector<HTMLDivElement>('#app')!;
const mobile = isMobileDevice();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0e12);
scene.fog = new THREE.Fog(0x0d0e12, 18, 42);

const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 100);
scene.add(camera);

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
if (mobile) {
  hud.setOverlayInstructions('Joystick mover · Arrastrar mirar · ● disparar/atacar · Toca para empezar');
  document.body.classList.add('mobile-layout');
}

let playerHealth = PLAYER_MAX_HEALTH;
let gameOver = false;

const controller = new FirstPersonController(
  camera,
  renderer.domElement,
  arena.collisionBoxes,
  arena.bounds,
  arena.playerStart,
  (locked) => {
    if (!locked && !gameOver && !mobile) hud.showOverlay('PAUSADO', 'Click para continuar');
  },
);

const weapon = new Weapon(camera);
const rifle = new Rifle(camera);
const knife = new Knife(camera);
const waveManager = new WaveManager(scene, arena.spawnPoints, arena.collisionBoxes, () => {});

type WeaponSlot = 'pistol' | 'rifle' | 'knife';
const WEAPON_CYCLE: WeaponSlot[] = ['pistol', 'rifle', 'knife'];
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

// Weapon switch animation: the current weapon lowers off screen, then the new
// one is raised into view.
const SWITCH_TIME = 0.14;
let switching = false;
let switchPhase: 'lower' | 'raise' = 'lower';
let switchTimer = 0;
let switchTo: WeaponSlot = 'pistol';

function requestSwitch(slot: WeaponSlot) {
  if (switching || slot === activeSlot) return;
  switching = true;
  switchPhase = 'lower';
  switchTimer = 0;
  switchTo = slot;
}

function cycleWeapon() {
  const from = switching ? switchTo : activeSlot;
  requestSwitch(WEAPON_CYCLE[(WEAPON_CYCLE.indexOf(from) + 1) % WEAPON_CYCLE.length]);
}

function updateSwitch(dt: number) {
  if (!switching) return;
  switchTimer += dt;
  const t = Math.min(1, switchTimer / SWITCH_TIME);
  if (switchPhase === 'lower') {
    weaponForSlot(activeSlot).setSwitchOffset(t);
    if (t >= 1) {
      weaponForSlot(activeSlot).setActive(false);
      activeSlot = switchTo;
      weaponForSlot(activeSlot).setActive(true);
      weaponForSlot(activeSlot).setSwitchOffset(1);
      switchPhase = 'raise';
      switchTimer = 0;
    }
  } else {
    weaponForSlot(activeSlot).setSwitchOffset(1 - t);
    if (t >= 1) {
      weaponForSlot(activeSlot).setSwitchOffset(0);
      switching = false;
    }
  }
}

let isMouseDown = false;

const mobileControls = mobile
  ? new MobileControls(appEl, {
      onMove: (x, z) => controller.setTouchMove(x, z),
      onLook: (dx, dy) => controller.addLookDelta(dx, dy),
      onFireStart: () => {
        isMouseDown = true;
      },
      onFireEnd: () => {
        isMouseDown = false;
      },
      onJumpStart: () => controller.press('Space'),
      onJumpEnd: () => controller.release('Space'),
      onReload: () => {
        if (activeSlot === 'pistol') weapon.tryReload();
        else if (activeSlot === 'rifle') rifle.tryReload();
      },
      onSwitchWeapon: () => cycleWeapon(),
    })
  : null;

hud.onOverlayClick(() => {
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
  if (e.button === 0) isMouseDown = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) isMouseDown = false;
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') {
    if (activeSlot === 'pistol') weapon.tryReload();
    else if (activeSlot === 'rifle') rifle.tryReload();
  }
  if (e.code === 'Digit1') requestSwitch('pistol');
  if (e.code === 'Digit2') requestSwitch('rifle');
  if (e.code === 'Digit3') requestSwitch('knife');
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', syncViewportSize);
window.addEventListener('orientationchange', syncViewportSize);

function endGame() {
  gameOver = true;
  isMouseDown = false;
  document.exitPointerLock();
  mobileControls?.setVisible(false);
  hud.showOverlay('HAS MUERTO', `Sobreviviste hasta la oleada ${waveManager.waveNumber}. Click para reintentar.`);
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (controller.locked && !gameOver) {
    controller.update(dt);
    updateSwitch(dt);

    if (isMouseDown && !switching) {
      let hit = null;
      let damage = 0;
      if (activeSlot === 'pistol') {
        hit = weapon.fire(waveManager.raycastTargets);
        damage = weapon.damage;
      } else if (activeSlot === 'rifle') {
        hit = rifle.fire(waveManager.raycastTargets);
        damage = rifle.damage;
      } else {
        hit = knife.swing(waveManager.raycastTargets);
        damage = knife.damage;
      }
      if (hit) {
        const zombie = hit.object.userData.zombieRef as Zombie | undefined;
        zombie?.takeDamage(damage);
      }
    }
    weapon.update(dt);
    rifle.update(dt);
    knife.update(dt);

    const { damageToPlayer } = waveManager.update(dt, camera.position);
    if (damageToPlayer > 0) {
      playerHealth = Math.max(0, playerHealth - damageToPlayer);
      hud.flashHit();
      if (playerHealth <= 0 && !gameOver) endGame();
    }

    hud.setHealth(playerHealth, PLAYER_MAX_HEALTH);
    if (activeSlot === 'pistol') {
      hud.setAmmo(weapon.ammoInMag, weapon.reserveAmmo, weapon.isReloading);
    } else if (activeSlot === 'rifle') {
      hud.setAmmo(rifle.ammoInMag, rifle.reserveAmmo, rifle.isReloading);
    } else {
      hud.showMelee();
    }
    hud.setWaveInfo(waveManager.waveNumber, waveManager.zombiesRemaining, waveManager.state, waveManager.intermissionRemaining);
  }

  renderer.render(scene, camera);
}

animate();

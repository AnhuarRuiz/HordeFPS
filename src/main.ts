import * as THREE from 'three';
import './style.css';
import { buildArena } from './world/Arena.ts';
import { FirstPersonController } from './player/FirstPersonController.ts';
import { MobileControls, isMobileDevice } from './player/MobileControls.ts';
import { Weapon } from './weapons/Weapon.ts';
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
const knife = new Knife(camera);
const waveManager = new WaveManager(scene, arena.spawnPoints, arena.collisionBoxes, () => {});

type WeaponSlot = 'pistol' | 'knife';
let activeSlot: WeaponSlot = 'pistol';

function setActiveSlot(slot: WeaponSlot) {
  activeSlot = slot;
  weapon.setActive(slot === 'pistol');
  knife.setActive(slot === 'knife');
}
setActiveSlot('pistol');

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
      },
      onSwitchWeapon: () => setActiveSlot(activeSlot === 'pistol' ? 'knife' : 'pistol'),
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
  if (e.code === 'KeyR' && activeSlot === 'pistol') weapon.tryReload();
  if (e.code === 'Digit1') setActiveSlot('pistol');
  if (e.code === 'Digit2') setActiveSlot('knife');
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

    if (isMouseDown) {
      const hit =
        activeSlot === 'pistol'
          ? weapon.fire(waveManager.raycastTargets)
          : knife.swing(waveManager.raycastTargets);
      if (hit) {
        const zombie = hit.object.userData.zombieRef as Zombie | undefined;
        zombie?.takeDamage(activeSlot === 'pistol' ? weapon.damage : knife.damage);
      }
    }
    weapon.update(dt);
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
    } else {
      hud.showMelee();
    }
    hud.setWaveInfo(waveManager.waveNumber, waveManager.zombiesRemaining, waveManager.state, waveManager.intermissionRemaining);
  }

  renderer.render(scene, camera);
}

animate();

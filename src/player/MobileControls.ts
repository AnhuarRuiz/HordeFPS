export type WeaponSlotId = 'pistol' | 'rifle' | 'knife';

export interface MobileControlsCallbacks {
  onMove: (x: number, z: number) => void;
  onLook: (dx: number, dy: number) => void;
  onFireStart: () => void;
  onFireEnd: () => void;
  onJumpStart: () => void;
  onJumpEnd: () => void;
  onReload: () => void;
  onSelectWeapon: (slot: WeaponSlotId) => void;
  onBuy: (key: string) => void;
  onPauseChange: (paused: boolean) => void;
  onSensitivityChange: (mult: number) => void;
}

const SHOP_BUTTONS: { key: string; glyph: string; label: string }[] = [
  { key: '4', glyph: '⛁', label: 'Recargar munición' },
  { key: '5', glyph: '✚', label: 'Botiquín' },
  { key: '6', glyph: '♥', label: 'Vida máxima' },
];

const JOYSTICK_RADIUS = 55;

const WEAPON_ICONS: Record<WeaponSlotId, string> = {
  pistol:
    '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M4 10h16v3h5a1 1 0 0 1 1 1v3h-8v-2h-3l-3 6H7l2-6H4z"/></svg>',
  rifle:
    '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M2 13l5-1 2-2h11v3h4v-2h2v6h-2v-2h-4v2h-8l-1 4h-4l1-4H6l-1 3H2z"/></svg>',
  knife:
    '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M27 4 13 18l1 3 3 1L28 8zM11 20l-6 6 1 2 2 1 6-6z"/></svg>',
};

const WEAPON_LABELS: Record<WeaponSlotId, string> = {
  pistol: 'Pistola',
  rifle: 'Fusil',
  knife: 'Cuchillo',
};

export function isMobileDevice(): boolean {
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  return hasTouch && coarsePointer;
}

// The circular action buttons (fire/jump/reload/pause) each live inside a
// ".ctrl-anchor" wrapper: the wrapper owns position + the ui-scale transform,
// while the button itself keeps its own :active press-feedback transform.
// That split avoids the two transforms fighting over the same CSS property.
const ANCHOR_DRAG_IDS = ['pause', 'fire', 'jump', 'reload'] as const;
// These own their position/scale directly, no wrapper needed.
const DIRECT_DRAG_IDS = ['joystick', 'weapons'] as const;
type DragId = (typeof ANCHOR_DRAG_IDS)[number] | (typeof DIRECT_DRAG_IDS)[number];

const MIN_UI_SCALE = 0.75;
const MAX_UI_SCALE = 1.4;
const MIN_SENSITIVITY = 0.5;
const MAX_SENSITIVITY = 2.5;
const SETTINGS_STORAGE_KEY = 'hordefps_mobile_settings_v1';

interface StoredMobileSettings {
  uiScale: number;
  sensitivity: number;
  positions: Partial<Record<DragId, { xFrac: number; yFrac: number }>>;
}

function loadStoredSettings(): StoredMobileSettings {
  const fallback: StoredMobileSettings = { uiScale: 1, sensitivity: 1, positions: {} };
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      uiScale: typeof parsed.uiScale === 'number' ? parsed.uiScale : fallback.uiScale,
      sensitivity: typeof parsed.sensitivity === 'number' ? parsed.sensitivity : fallback.sensitivity,
      positions: typeof parsed.positions === 'object' && parsed.positions ? parsed.positions : {},
    };
  } catch {
    return fallback;
  }
}

export class MobileControls {
  private root: HTMLDivElement;
  private callbacks: MobileControlsCallbacks;
  private joystickTouchId: number | null = null;
  private joystickCenter = { x: 0, y: 0 };
  private lookTouchId: number | null = null;
  private lastLookX = 0;
  private lastLookY = 0;
  private fireTouchId: number | null = null;
  private lastFireX = 0;
  private lastFireY = 0;
  private weaponSlots: HTMLButtonElement[] = [];
  private shopDock: HTMLDivElement;

  private paused = false;
  private editMode = false;
  private settings: StoredMobileSettings;
  private settingsPanel: HTMLDivElement;
  private editToggleBtn: HTMLButtonElement;
  private uiScaleValueEl: HTMLSpanElement;
  private sensitivityValueEl: HTMLSpanElement;

  private activeDrag: { id: DragId; el: HTMLElement; touchId: number; offsetX: number; offsetY: number } | null =
    null;

  constructor(container: HTMLElement, callbacks: MobileControlsCallbacks) {
    this.callbacks = callbacks;
    this.settings = loadStoredSettings();
    this.settings.uiScale = clamp(this.settings.uiScale, MIN_UI_SCALE, MAX_UI_SCALE);
    this.settings.sensitivity = clamp(this.settings.sensitivity, MIN_SENSITIVITY, MAX_SENSITIVITY);

    this.root = document.createElement('div');
    this.root.id = 'mobile-controls';
    this.root.style.display = 'none';
    const slots: WeaponSlotId[] = ['pistol', 'rifle', 'knife'];
    const dockButtons = slots
      .map(
        (slot, i) => `
        <button class="weapon-slot" data-slot="${slot}" aria-label="${WEAPON_LABELS[slot]}">
          <span class="weapon-key">${i + 1}</span>
          <span class="weapon-icon">${WEAPON_ICONS[slot]}</span>
        </button>`,
      )
      .join('');

    const shopButtons = SHOP_BUTTONS.map(
      (item) => `
        <button class="mobile-btn shop-buy-btn" data-key="${item.key}" aria-label="${item.label}">
          <span class="btn-glyph">${item.glyph}</span>
        </button>`,
    ).join('');

    this.root.innerHTML = `
      <div id="touch-look-layer"></div>
      <div id="joystick-base" data-drag-id="joystick"><div id="joystick-knob"></div></div>
      <div id="shop-dock">${shopButtons}</div>
      <div id="weapon-dock" data-drag-id="weapons">${dockButtons}</div>
      <div class="ctrl-anchor" id="anchor-reload" data-drag-id="reload">
        <button class="mobile-btn" id="btn-reload" aria-label="Recargar"><span class="btn-glyph">⟳</span></button>
      </div>
      <div class="ctrl-anchor" id="anchor-jump" data-drag-id="jump">
        <button class="mobile-btn" id="btn-jump" aria-label="Saltar"><span class="btn-glyph">▲</span></button>
      </div>
      <div class="ctrl-anchor" id="anchor-fire" data-drag-id="fire">
        <button class="mobile-btn mobile-btn-fire" id="btn-fire" aria-label="Disparar"></button>
      </div>
      <div class="ctrl-anchor" id="anchor-pause" data-drag-id="pause">
        <button class="mobile-btn" id="btn-pause" aria-label="Pausa"><span class="btn-glyph">❚❚</span></button>
      </div>
      <div id="mobile-settings">
        <div class="settings-card">
          <h2>Ajustes</h2>
          <label class="settings-row">
            <span>Tamaño de interfaz</span>
            <input type="range" id="setting-ui-scale" min="${MIN_UI_SCALE}" max="${MAX_UI_SCALE}" step="0.05">
            <span class="settings-value" id="setting-ui-scale-value">100%</span>
          </label>
          <label class="settings-row">
            <span>Sensibilidad de cámara</span>
            <input type="range" id="setting-sensitivity" min="${MIN_SENSITIVITY}" max="${MAX_SENSITIVITY}" step="0.05">
            <span class="settings-value" id="setting-sensitivity-value">100%</span>
          </label>
          <div class="settings-row settings-edit-row">
            <span>Mover botones</span>
            <button class="settings-toggle" id="setting-edit-toggle">Activar</button>
          </div>
          <p class="settings-hint">Con "Mover botones" activo, arrastra cualquier control a donde quieras.</p>
          <div class="settings-actions">
            <button class="settings-btn settings-btn-secondary" id="setting-reset">Restablecer posiciones</button>
            <button class="settings-btn settings-btn-primary" id="setting-resume">Reanudar</button>
          </div>
        </div>
      </div>
    `;
    container.appendChild(this.root);

    const lookLayer = this.root.querySelector<HTMLDivElement>('#touch-look-layer')!;
    const joystickBase = this.root.querySelector<HTMLDivElement>('#joystick-base')!;
    const joystickKnob = this.root.querySelector<HTMLDivElement>('#joystick-knob')!;
    const fireBtn = this.root.querySelector<HTMLButtonElement>('#btn-fire')!;
    const jumpBtn = this.root.querySelector<HTMLButtonElement>('#btn-jump')!;
    const reloadBtn = this.root.querySelector<HTMLButtonElement>('#btn-reload')!;
    const pauseBtn = this.root.querySelector<HTMLButtonElement>('#btn-pause')!;
    this.shopDock = this.root.querySelector<HTMLDivElement>('#shop-dock')!;
    this.settingsPanel = this.root.querySelector<HTMLDivElement>('#mobile-settings')!;
    this.editToggleBtn = this.root.querySelector<HTMLButtonElement>('#setting-edit-toggle')!;
    this.uiScaleValueEl = this.root.querySelector<HTMLSpanElement>('#setting-ui-scale-value')!;
    this.sensitivityValueEl = this.root.querySelector<HTMLSpanElement>('#setting-sensitivity-value')!;

    // Register drag listeners before the normal interaction listeners below so
    // dragging can intercept touches while paused + editing (see setupDrag).
    const dragEls = this.root.querySelectorAll<HTMLElement>('[data-drag-id]');
    for (const el of dragEls) this.setupDrag(el, el.dataset.dragId as DragId);
    window.addEventListener('touchmove', this.handleDragMove, { passive: false });
    window.addEventListener('touchend', this.handleDragEnd);
    window.addEventListener('touchcancel', this.handleDragEnd);
    window.addEventListener('resize', () => {
      if (this.root.style.display !== 'none') this.applyPositions();
    });

    this.setupJoystick(joystickBase, joystickKnob, callbacks.onMove);
    this.setupLook(lookLayer, callbacks.onLook);
    this.setupFireLookButton(fireBtn, callbacks.onFireStart, callbacks.onFireEnd, callbacks.onLook);
    this.setupHoldButton(jumpBtn, callbacks.onJumpStart, callbacks.onJumpEnd);
    this.setupTapButton(reloadBtn, callbacks.onReload);
    this.setupTapButton(pauseBtn, () => this.togglePause());

    this.weaponSlots = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.weapon-slot'));
    for (const btn of this.weaponSlots) {
      const slot = btn.dataset.slot as WeaponSlotId;
      this.setupTapButton(btn, () => callbacks.onSelectWeapon(slot));
    }

    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('.shop-buy-btn')) {
      const key = btn.dataset.key!;
      this.setupTapButton(btn, () => callbacks.onBuy(key));
    }

    this.setupSettingsPanel();
    this.root.style.setProperty('--ui-scale', String(this.settings.uiScale));
    this.callbacks.onSensitivityChange(this.settings.sensitivity);
  }

  setShopVisible(visible: boolean) {
    this.shopDock.style.display = visible ? 'flex' : 'none';
  }

  // Highlight the currently drawn weapon in the dock.
  setActiveWeapon(slot: WeaponSlotId) {
    for (const btn of this.weaponSlots) {
      btn.classList.toggle('active', btn.dataset.slot === slot);
    }
  }

  setVisible(visible: boolean) {
    this.root.style.display = visible ? 'block' : 'none';
    if (visible) this.applyPositions();
  }

  private setupSettingsPanel() {
    const uiScaleInput = this.root.querySelector<HTMLInputElement>('#setting-ui-scale')!;
    const sensitivityInput = this.root.querySelector<HTMLInputElement>('#setting-sensitivity')!;
    const resetBtn = this.root.querySelector<HTMLButtonElement>('#setting-reset')!;
    const resumeBtn = this.root.querySelector<HTMLButtonElement>('#setting-resume')!;

    uiScaleInput.value = String(this.settings.uiScale);
    sensitivityInput.value = String(this.settings.sensitivity);
    this.updateScaleLabels();

    uiScaleInput.addEventListener('input', () => {
      this.settings.uiScale = clamp(parseFloat(uiScaleInput.value), MIN_UI_SCALE, MAX_UI_SCALE);
      this.root.style.setProperty('--ui-scale', String(this.settings.uiScale));
      this.updateScaleLabels();
      this.saveSettings();
    });

    sensitivityInput.addEventListener('input', () => {
      this.settings.sensitivity = clamp(parseFloat(sensitivityInput.value), MIN_SENSITIVITY, MAX_SENSITIVITY);
      this.callbacks.onSensitivityChange(this.settings.sensitivity);
      this.updateScaleLabels();
      this.saveSettings();
    });

    this.editToggleBtn.addEventListener('click', () => {
      this.editMode = !this.editMode;
      this.root.classList.toggle('edit-mode', this.editMode);
      this.editToggleBtn.textContent = this.editMode ? 'Listo' : 'Activar';
      this.editToggleBtn.classList.toggle('active', this.editMode);
    });

    resetBtn.addEventListener('click', () => this.resetPositions());
    resumeBtn.addEventListener('click', () => this.resume());
  }

  private updateScaleLabels() {
    this.uiScaleValueEl.textContent = `${Math.round(this.settings.uiScale * 100)}%`;
    this.sensitivityValueEl.textContent = `${Math.round(this.settings.sensitivity * 100)}%`;
  }

  private togglePause() {
    if (this.paused) this.resume();
    else this.enterPause();
  }

  private enterPause() {
    this.paused = true;
    this.root.classList.add('paused');
    this.settingsPanel.classList.add('visible');
    // Release any input that was mid-hold when the pause button was tapped,
    // so a held joystick/fire/jump doesn't stay stuck while the menu is open.
    this.joystickTouchId = null;
    this.lookTouchId = null;
    this.fireTouchId = null;
    this.callbacks.onMove(0, 0);
    this.callbacks.onFireEnd();
    this.callbacks.onJumpEnd();
    this.callbacks.onPauseChange(true);
  }

  private resume() {
    this.paused = false;
    this.editMode = false;
    this.root.classList.remove('paused', 'edit-mode');
    this.settingsPanel.classList.remove('visible');
    this.editToggleBtn.textContent = 'Activar';
    this.editToggleBtn.classList.remove('active');
    this.callbacks.onPauseChange(false);
  }

  private findTouch(touches: TouchList, id: number | null): Touch | null {
    if (id === null) return null;
    for (let i = 0; i < touches.length; i++) {
      if (touches[i].identifier === id) return touches[i];
    }
    return null;
  }

  // Generic drag-to-reposition, shared by the joystick, weapon dock, and the
  // wrapped circular buttons. Only active while paused + edit mode; otherwise
  // it no-ops immediately and lets the element's normal listener run. Uses
  // capture so it runs before a wrapped button's own listener (registered on
  // the child), and stopImmediatePropagation to block that listener once a
  // drag actually starts.
  private setupDrag(el: HTMLElement, id: DragId) {
    el.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        if (!this.paused || !this.editMode) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const touch = e.changedTouches[0];
        // Bake the current rendered position into left/top *before* swapping
        // the transform, so dropping a centering translateX(-50%) (weapon
        // dock) doesn't jump the element sideways the instant the drag starts.
        const rect = el.getBoundingClientRect();
        el.style.left = `${rect.left}px`;
        el.style.top = `${rect.top}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        // Re-anchoring the scale to top-left (from whatever corner the default
        // CSS used) keeps this rect exactly where it just was, and — crucially
        // — makes the rendered position always equal left/top going forward,
        // so saving/restoring rect.left as a fraction round-trips exactly.
        el.style.transformOrigin = 'top left';
        el.style.transform = 'scale(var(--ui-scale))';
        this.activeDrag = {
          id,
          el,
          touchId: touch.identifier,
          offsetX: touch.clientX - rect.left,
          offsetY: touch.clientY - rect.top,
        };
      },
      { capture: true, passive: false },
    );
  }

  private handleDragMove = (e: TouchEvent) => {
    if (!this.activeDrag) return;
    const touch = this.findTouch(e.changedTouches, this.activeDrag.touchId);
    if (!touch) return;
    e.preventDefault();
    const { el } = this.activeDrag;
    const rect = el.getBoundingClientRect();
    const left = clamp(touch.clientX - this.activeDrag.offsetX, 0, window.innerWidth - rect.width);
    const top = clamp(touch.clientY - this.activeDrag.offsetY, 0, window.innerHeight - rect.height);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  };

  private handleDragEnd = (e: TouchEvent) => {
    if (!this.activeDrag) return;
    const touch = this.findTouch(e.changedTouches, this.activeDrag.touchId);
    if (!touch) return;
    const { id, el } = this.activeDrag;
    this.activeDrag = null;
    const rect = el.getBoundingClientRect();
    this.settings.positions[id] = { xFrac: rect.left / window.innerWidth, yFrac: rect.top / window.innerHeight };
    this.saveSettings();
  };

  private applyPositions() {
    for (const idKey of Object.keys(this.settings.positions) as DragId[]) {
      const pos = this.settings.positions[idKey];
      if (!pos) continue;
      const el = this.root.querySelector<HTMLElement>(`[data-drag-id="${idKey}"]`);
      if (!el) continue;
      el.style.transformOrigin = 'top left';
      el.style.transform = 'scale(var(--ui-scale))';
      const left = clamp(pos.xFrac * window.innerWidth, 0, window.innerWidth - el.offsetWidth);
      const top = clamp(pos.yFrac * window.innerHeight, 0, window.innerHeight - el.offsetHeight);
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }
  }

  private resetPositions() {
    this.settings.positions = {};
    for (const id of [...ANCHOR_DRAG_IDS, ...DIRECT_DRAG_IDS]) {
      const el = this.root.querySelector<HTMLElement>(`[data-drag-id="${id}"]`);
      if (!el) continue;
      el.style.left = '';
      el.style.top = '';
      el.style.right = '';
      el.style.bottom = '';
      el.style.transform = '';
      el.style.transformOrigin = '';
    }
    this.saveSettings();
  }

  private saveSettings() {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Storage unavailable (private mode, quota) — settings just won't persist.
    }
  }

  private get joystickRadius(): number {
    return JOYSTICK_RADIUS * this.settings.uiScale;
  }

  private setupJoystick(base: HTMLElement, knob: HTMLElement, onMove: (x: number, z: number) => void) {
    base.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        if (this.paused) return;
        if (this.joystickTouchId !== null) return;
        const touch = e.changedTouches[0];
        this.joystickTouchId = touch.identifier;
        const rect = base.getBoundingClientRect();
        this.joystickCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        e.preventDefault();
      },
      { passive: false },
    );

    base.addEventListener(
      'touchmove',
      (e: TouchEvent) => {
        if (this.paused) return;
        const touch = this.findTouch(e.changedTouches, this.joystickTouchId);
        if (!touch) return;
        let dx = touch.clientX - this.joystickCenter.x;
        let dy = touch.clientY - this.joystickCenter.y;
        const dist = Math.hypot(dx, dy);
        const radius = this.joystickRadius;
        if (dist > radius) {
          dx = (dx / dist) * radius;
          dy = (dy / dist) * radius;
        }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        onMove(dx / radius, -dy / radius);
        e.preventDefault();
      },
      { passive: false },
    );

    const release = (e: TouchEvent) => {
      const touch = this.findTouch(e.changedTouches, this.joystickTouchId);
      if (!touch) return;
      this.joystickTouchId = null;
      knob.style.transform = 'translate(0px, 0px)';
      onMove(0, 0);
    };
    base.addEventListener('touchend', release);
    base.addEventListener('touchcancel', release);
  }

  private setupLook(layer: HTMLElement, onLook: (dx: number, dy: number) => void) {
    layer.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        if (this.paused) return;
        if (this.lookTouchId !== null) return;
        const touch = e.changedTouches[0];
        this.lookTouchId = touch.identifier;
        this.lastLookX = touch.clientX;
        this.lastLookY = touch.clientY;
        e.preventDefault();
      },
      { passive: false },
    );

    layer.addEventListener(
      'touchmove',
      (e: TouchEvent) => {
        if (this.paused) return;
        const touch = this.findTouch(e.changedTouches, this.lookTouchId);
        if (!touch) return;
        const dx = touch.clientX - this.lastLookX;
        const dy = touch.clientY - this.lastLookY;
        this.lastLookX = touch.clientX;
        this.lastLookY = touch.clientY;
        onLook(dx, dy);
        e.preventDefault();
      },
      { passive: false },
    );

    const release = (e: TouchEvent) => {
      const touch = this.findTouch(e.changedTouches, this.lookTouchId);
      if (!touch) return;
      this.lookTouchId = null;
    };
    layer.addEventListener('touchend', release);
    layer.addEventListener('touchcancel', release);
  }

  // Fire button that doubles as an aim surface: press to shoot, and drag the
  // same finger to move the view — so the player can shoot and aim at once,
  // in addition to the separate look area of the screen.
  private setupFireLookButton(
    el: HTMLElement,
    onStart: () => void,
    onEnd: () => void,
    onLook: (dx: number, dy: number) => void,
  ) {
    el.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        if (this.paused) return;
        e.preventDefault();
        e.stopPropagation();
        if (this.fireTouchId !== null) return;
        const touch = e.changedTouches[0];
        this.fireTouchId = touch.identifier;
        this.lastFireX = touch.clientX;
        this.lastFireY = touch.clientY;
        onStart();
      },
      { passive: false },
    );

    el.addEventListener(
      'touchmove',
      (e: TouchEvent) => {
        const touch = this.findTouch(e.changedTouches, this.fireTouchId);
        if (!touch) return;
        e.preventDefault();
        e.stopPropagation();
        const dx = touch.clientX - this.lastFireX;
        const dy = touch.clientY - this.lastFireY;
        this.lastFireX = touch.clientX;
        this.lastFireY = touch.clientY;
        onLook(dx, dy);
      },
      { passive: false },
    );

    const end = (e: TouchEvent) => {
      const touch = this.findTouch(e.changedTouches, this.fireTouchId);
      if (!touch) return;
      e.preventDefault();
      e.stopPropagation();
      this.fireTouchId = null;
      onEnd();
    };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }

  private setupHoldButton(el: HTMLElement, onStart: () => void, onEnd: () => void) {
    el.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        if (this.paused) return;
        e.preventDefault();
        e.stopPropagation();
        onStart();
      },
      { passive: false },
    );
    const end = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onEnd();
    };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }

  private setupTapButton(el: HTMLElement, onTap: () => void) {
    el.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        if (this.paused && el.id !== 'btn-pause') return;
        e.preventDefault();
        e.stopPropagation();
        onTap();
      },
      { passive: false },
    );
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

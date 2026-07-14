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

export class MobileControls {
  private root: HTMLDivElement;
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

  constructor(container: HTMLElement, callbacks: MobileControlsCallbacks) {
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
      <div id="joystick-base"><div id="joystick-knob"></div></div>
      <div id="shop-dock">${shopButtons}</div>
      <div id="weapon-dock">${dockButtons}</div>
      <button class="mobile-btn" id="btn-reload" aria-label="Recargar"><span class="btn-glyph">⟳</span></button>
      <button class="mobile-btn" id="btn-jump" aria-label="Saltar"><span class="btn-glyph">▲</span></button>
      <button class="mobile-btn mobile-btn-fire" id="btn-fire" aria-label="Disparar"></button>
    `;
    container.appendChild(this.root);

    const lookLayer = this.root.querySelector<HTMLDivElement>('#touch-look-layer')!;
    const joystickBase = this.root.querySelector<HTMLDivElement>('#joystick-base')!;
    const joystickKnob = this.root.querySelector<HTMLDivElement>('#joystick-knob')!;
    const fireBtn = this.root.querySelector<HTMLButtonElement>('#btn-fire')!;
    const jumpBtn = this.root.querySelector<HTMLButtonElement>('#btn-jump')!;
    const reloadBtn = this.root.querySelector<HTMLButtonElement>('#btn-reload')!;
    this.shopDock = this.root.querySelector<HTMLDivElement>('#shop-dock')!;

    this.setupJoystick(joystickBase, joystickKnob, callbacks.onMove);
    this.setupLook(lookLayer, callbacks.onLook);
    this.setupFireLookButton(fireBtn, callbacks.onFireStart, callbacks.onFireEnd, callbacks.onLook);
    this.setupHoldButton(jumpBtn, callbacks.onJumpStart, callbacks.onJumpEnd);
    this.setupTapButton(reloadBtn, callbacks.onReload);

    this.weaponSlots = Array.from(this.root.querySelectorAll<HTMLButtonElement>('.weapon-slot'));
    for (const btn of this.weaponSlots) {
      const slot = btn.dataset.slot as WeaponSlotId;
      this.setupTapButton(btn, () => callbacks.onSelectWeapon(slot));
    }

    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('.shop-buy-btn')) {
      const key = btn.dataset.key!;
      this.setupTapButton(btn, () => callbacks.onBuy(key));
    }
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
  }

  private findTouch(touches: TouchList, id: number | null): Touch | null {
    if (id === null) return null;
    for (let i = 0; i < touches.length; i++) {
      if (touches[i].identifier === id) return touches[i];
    }
    return null;
  }

  private setupJoystick(base: HTMLElement, knob: HTMLElement, onMove: (x: number, z: number) => void) {
    base.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
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
        const touch = this.findTouch(e.changedTouches, this.joystickTouchId);
        if (!touch) return;
        let dx = touch.clientX - this.joystickCenter.x;
        let dy = touch.clientY - this.joystickCenter.y;
        const dist = Math.hypot(dx, dy);
        if (dist > JOYSTICK_RADIUS) {
          dx = (dx / dist) * JOYSTICK_RADIUS;
          dy = (dy / dist) * JOYSTICK_RADIUS;
        }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        onMove(dx / JOYSTICK_RADIUS, -dy / JOYSTICK_RADIUS);
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
        e.preventDefault();
        e.stopPropagation();
        onTap();
      },
      { passive: false },
    );
  }
}

export interface MobileControlsCallbacks {
  onMove: (x: number, z: number) => void;
  onLook: (dx: number, dy: number) => void;
  onFireStart: () => void;
  onFireEnd: () => void;
  onJumpStart: () => void;
  onJumpEnd: () => void;
  onReload: () => void;
  onSwitchWeapon: () => void;
}

const JOYSTICK_RADIUS = 55;

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

  constructor(container: HTMLElement, callbacks: MobileControlsCallbacks) {
    this.root = document.createElement('div');
    this.root.id = 'mobile-controls';
    this.root.style.display = 'none';
    this.root.innerHTML = `
      <div id="touch-look-layer"></div>
      <div id="joystick-base"><div id="joystick-knob"></div></div>
      <div class="mobile-btn" id="btn-switch">🔪</div>
      <div class="mobile-btn" id="btn-reload">⟳</div>
      <div class="mobile-btn" id="btn-jump">▲</div>
      <div class="mobile-btn mobile-btn-fire" id="btn-fire">●</div>
    `;
    container.appendChild(this.root);

    const lookLayer = this.root.querySelector<HTMLDivElement>('#touch-look-layer')!;
    const joystickBase = this.root.querySelector<HTMLDivElement>('#joystick-base')!;
    const joystickKnob = this.root.querySelector<HTMLDivElement>('#joystick-knob')!;
    const fireBtn = this.root.querySelector<HTMLDivElement>('#btn-fire')!;
    const jumpBtn = this.root.querySelector<HTMLDivElement>('#btn-jump')!;
    const reloadBtn = this.root.querySelector<HTMLDivElement>('#btn-reload')!;
    const switchBtn = this.root.querySelector<HTMLDivElement>('#btn-switch')!;

    this.setupJoystick(joystickBase, joystickKnob, callbacks.onMove);
    this.setupLook(lookLayer, callbacks.onLook);
    this.setupFireLookButton(fireBtn, callbacks.onFireStart, callbacks.onFireEnd, callbacks.onLook);
    this.setupHoldButton(jumpBtn, callbacks.onJumpStart, callbacks.onJumpEnd);
    this.setupTapButton(reloadBtn, callbacks.onReload);
    this.setupTapButton(switchBtn, callbacks.onSwitchWeapon);
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

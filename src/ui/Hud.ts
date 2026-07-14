export interface ShopItem {
  key: string;
  label: string;
  price: number;
}

export class Hud {
  private root: HTMLDivElement;
  private overlay: HTMLDivElement;
  private overlayTitle: HTMLHeadingElement;
  private overlayBody: HTMLParagraphElement;
  private healthFill: HTMLDivElement;
  private healthNum: HTMLDivElement;
  private ammoMag: HTMLDivElement;
  private ammoReserve: HTMLDivElement;
  private waveLabel: HTMLDivElement;
  private zombiesLabel: HTMLDivElement;
  private moneyLabel: HTMLDivElement;
  private reloadIndicator: HTMLDivElement;
  private hitFlash: HTMLDivElement;
  private hitmarker: HTMLDivElement;
  private hitmarkerTimer: ReturnType<typeof setTimeout> | null = null;
  private shopPanel: HTMLDivElement;
  private shopTimer: HTMLSpanElement;
  private shopItemEls = new Map<string, HTMLDivElement>();

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="vignette"></div>
      <div id="crosshair"></div>
      <div id="hitmarker"></div>
      <div id="hit-flash"></div>
      <div id="top-center">
        <div id="wave-label">Oleada 1</div>
        <div id="zombies-label">0 zombies</div>
        <div id="money-label">$0</div>
      </div>
      <div id="reload-indicator">RECARGANDO</div>
      <div id="health-panel">
        <svg class="hp-heart" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21s-7.6-4.7-10.1-9.3C.2 8.4 1.9 4.9 5.3 4.9c2 0 3.4 1.1 4.2 2.4h1c.8-1.3 2.2-2.4 4.2-2.4 3.4 0 5.1 3.5 3.4 6.8C19.6 16.3 12 21 12 21Z"/></svg>
        <div id="health-track"><div id="health-fill"></div></div>
        <div id="health-num">100</div>
      </div>
      <div id="ammo-panel">
        <div id="ammo-mag">30</div>
        <div id="ammo-reserve">/ 150</div>
      </div>
      <div id="shop-panel">
        <div class="shop-title">TIENDA · siguiente oleada en <span id="shop-timer">12</span>s</div>
        <div id="shop-items"></div>
      </div>
    `;
    container.appendChild(this.root);

    this.overlay = document.createElement('div');
    this.overlay.id = 'overlay';
    this.overlay.innerHTML = `
      <h1 id="overlay-title">HORDE FPS</h1>
      <p id="overlay-body">WASD mover · Ratón apuntar · Click disparar/atacar · R recargar · 1/2/3 cambiar arma · F linterna · Espacio saltar</p>
      <p class="hint">Click para empezar</p>
    `;
    container.appendChild(this.overlay);

    this.healthFill = this.root.querySelector('#health-fill')!;
    this.healthNum = this.root.querySelector('#health-num')!;
    this.ammoMag = this.root.querySelector('#ammo-mag')!;
    this.ammoReserve = this.root.querySelector('#ammo-reserve')!;
    this.waveLabel = this.root.querySelector('#wave-label')!;
    this.zombiesLabel = this.root.querySelector('#zombies-label')!;
    this.moneyLabel = this.root.querySelector('#money-label')!;
    this.reloadIndicator = this.root.querySelector('#reload-indicator')!;
    this.hitFlash = this.root.querySelector('#hit-flash')!;
    this.hitmarker = this.root.querySelector('#hitmarker')!;
    this.shopPanel = this.root.querySelector('#shop-panel')!;
    this.shopTimer = this.root.querySelector('#shop-timer')!;
    this.overlayTitle = this.overlay.querySelector('#overlay-title')!;
    this.overlayBody = this.overlay.querySelector('#overlay-body')!;
  }

  setShopItems(items: ShopItem[]) {
    const container = this.root.querySelector<HTMLDivElement>('#shop-items')!;
    container.innerHTML = items
      .map(
        (item) => `
        <div class="shop-item" data-key="${item.key}">
          <span class="shop-key">${item.key}</span>
          <span class="shop-label">${item.label}</span>
          <span class="shop-price">$${item.price}</span>
        </div>`,
      )
      .join('');
    this.shopItemEls.clear();
    for (const item of items) {
      this.shopItemEls.set(item.key, container.querySelector<HTMLDivElement>(`[data-key="${item.key}"]`)!);
    }
  }

  showShop() {
    this.shopPanel.classList.add('visible');
  }

  hideShop() {
    this.shopPanel.classList.remove('visible');
  }

  updateShop(money: number, secondsRemaining: number, affordByKey: (key: string) => boolean) {
    this.shopTimer.textContent = String(Math.max(0, Math.ceil(secondsRemaining)));
    for (const [key, el] of this.shopItemEls) {
      el.classList.toggle('disabled', !affordByKey(key) || money < 0);
    }
  }

  setMoney(amount: number) {
    this.moneyLabel.textContent = `$${amount}`;
  }

  showHitmarker(headshot: boolean) {
    if (this.hitmarkerTimer) clearTimeout(this.hitmarkerTimer);
    this.hitmarker.classList.remove('active', 'headshot');
    // Force reflow so re-triggering the animation restarts it on rapid hits.
    void this.hitmarker.offsetWidth;
    this.hitmarker.classList.add('active');
    if (headshot) this.hitmarker.classList.add('headshot');
    this.hitmarkerTimer = setTimeout(() => this.hitmarker.classList.remove('active', 'headshot'), 130);
  }

  onOverlayClick(handler: () => void) {
    this.overlay.addEventListener('click', handler);
  }

  showOverlay(title: string, body: string) {
    this.overlayTitle.textContent = title;
    this.overlayBody.textContent = body;
    this.overlay.classList.remove('hidden');
  }

  hideOverlay() {
    this.overlay.classList.add('hidden');
  }

  setOverlayInstructions(text: string) {
    this.overlayBody.textContent = text;
  }

  setHealth(current: number, max: number) {
    const pct = Math.max(0, Math.min(100, (current / max) * 100));
    this.healthFill.style.width = `${pct}%`;
    this.healthNum.textContent = String(Math.max(0, Math.round(current)));
    // Green when healthy, amber when hurt, red when critical.
    const color = pct > 55 ? '#4ccf6a' : pct > 25 ? '#f0a326' : '#e23b3b';
    this.healthFill.style.background = color;
    this.root.classList.toggle('health-critical', pct <= 25);
  }

  setAmmo(inMag: number, reserve: number, reloading: boolean) {
    this.ammoMag.textContent = String(inMag);
    this.ammoReserve.textContent = `/ ${reserve}`;
    this.reloadIndicator.classList.toggle('visible', reloading);
  }

  showMelee() {
    this.ammoMag.textContent = 'CUCHILLO';
    this.ammoReserve.textContent = '';
    this.reloadIndicator.classList.remove('visible');
  }

  setWaveInfo(wave: number, zombiesRemaining: number, state: string, intermissionRemaining: number) {
    this.waveLabel.textContent = `Oleada ${wave}`;
    this.zombiesLabel.textContent =
      state === 'intermission'
        ? `Siguiente oleada en ${Math.ceil(intermissionRemaining)}s`
        : `${zombiesRemaining} zombies restantes`;
  }

  flashHit() {
    this.hitFlash.style.background = 'rgba(214, 40, 40, 0.35)';
    setTimeout(() => {
      this.hitFlash.style.background = 'rgba(214, 40, 40, 0)';
    }, 60);
  }
}

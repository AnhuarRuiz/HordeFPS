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
  private reloadIndicator: HTMLDivElement;
  private hitFlash: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="crosshair"></div>
      <div id="hit-flash"></div>
      <div id="top-center">
        <div id="wave-label">Oleada 1</div>
        <div id="zombies-label">0 zombies</div>
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
    `;
    container.appendChild(this.root);

    this.overlay = document.createElement('div');
    this.overlay.id = 'overlay';
    this.overlay.innerHTML = `
      <h1 id="overlay-title">HORDE FPS</h1>
      <p id="overlay-body">WASD mover · Ratón apuntar · Click disparar/atacar · R recargar · 1/2/3 cambiar arma · Espacio saltar</p>
      <p class="hint">Click para empezar</p>
    `;
    container.appendChild(this.overlay);

    this.healthFill = this.root.querySelector('#health-fill')!;
    this.healthNum = this.root.querySelector('#health-num')!;
    this.ammoMag = this.root.querySelector('#ammo-mag')!;
    this.ammoReserve = this.root.querySelector('#ammo-reserve')!;
    this.waveLabel = this.root.querySelector('#wave-label')!;
    this.zombiesLabel = this.root.querySelector('#zombies-label')!;
    this.reloadIndicator = this.root.querySelector('#reload-indicator')!;
    this.hitFlash = this.root.querySelector('#hit-flash')!;
    this.overlayTitle = this.overlay.querySelector('#overlay-title')!;
    this.overlayBody = this.overlay.querySelector('#overlay-body')!;
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

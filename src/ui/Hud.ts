export class Hud {
  private root: HTMLDivElement;
  private overlay: HTMLDivElement;
  private overlayTitle: HTMLHeadingElement;
  private overlayBody: HTMLParagraphElement;
  private healthInner: HTMLDivElement;
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
        <div id="wave-label">Wave 1</div>
        <div id="zombies-label">0 zombies left</div>
      </div>
      <div id="reload-indicator">RECARGANDO</div>
      <div id="bottom-left">
        <div id="health-bar-outer"><div id="health-bar-inner"></div></div>
        <div>VIDA</div>
      </div>
      <div id="bottom-right">
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

    this.healthInner = this.root.querySelector('#health-bar-inner')!;
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
    this.healthInner.style.width = `${pct}%`;
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

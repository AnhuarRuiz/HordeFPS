import * as THREE from 'three';

// Small blood-cube spatter kicked out from a hit, plus a floor pool left
// behind on a kill. Both are cheap unlit boxes/discs so a horde of these
// doesn't cost much, and pools are capped so they don't grow forever.
const PARTICLE_LIFETIME = 0.45;
const PARTICLE_GRAVITY = 9;
const MAX_POOLS = 40;

const particleGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
const poolGeo = new THREE.CircleGeometry(0.5, 10);

interface Particle {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  velocity: THREE.Vector3;
  life: number;
}

interface Pool {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
}

function randomBloodColor(): THREE.Color {
  return new THREE.Color(0.35 + Math.random() * 0.25, 0.01, 0.01);
}

export class BloodEffects {
  private scene: THREE.Scene;
  private particles: Particle[] = [];
  private pools: Pool[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  // Spatter kicked out from a bullet/knife impact at the hit point.
  spawnHit(position: THREE.Vector3, headshot: boolean) {
    const count = headshot ? 8 : 5;
    for (let i = 0; i < count; i++) {
      const material = new THREE.MeshBasicMaterial({ color: randomBloodColor() });
      const mesh = new THREE.Mesh(particleGeo, material);
      mesh.position.copy(position);
      mesh.scale.setScalar(0.6 + Math.random() * 0.8);
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 2.6;
      const velocity = new THREE.Vector3(Math.cos(angle) * speed, 1 + Math.random() * 2.2, Math.sin(angle) * speed);
      this.scene.add(mesh);
      this.particles.push({ mesh, material, velocity, life: PARTICLE_LIFETIME });
    }
  }

  // A dark pool left on the floor where a zombie died.
  spawnPool(position: THREE.Vector3) {
    const material = new THREE.MeshBasicMaterial({ color: 0x3a0505, transparent: true, opacity: 0.8 });
    const mesh = new THREE.Mesh(poolGeo, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = Math.random() * Math.PI * 2;
    mesh.position.set(position.x, 0.015, position.z);
    mesh.scale.setScalar(0.45 + Math.random() * 0.5);
    this.scene.add(mesh);
    this.pools.push({ mesh, material });
    if (this.pools.length > MAX_POOLS) {
      const old = this.pools.shift()!;
      this.scene.remove(old.mesh);
      old.material.dispose();
    }
  }

  update(dt: number) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        p.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.velocity.y -= PARTICLE_GRAVITY * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      if (p.mesh.position.y < 0.03) {
        p.mesh.position.y = 0.03;
        p.velocity.set(0, 0, 0);
      }
      p.material.opacity = Math.min(1, p.life / PARTICLE_LIFETIME);
      p.material.transparent = true;
    }
  }
}

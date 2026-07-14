import * as THREE from 'three';

export interface CollisionBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ArenaBuildResult {
  group: THREE.Group;
  collisionBoxes: CollisionBox[];
  // Solid meshes (walls + cover) for raycasting so shots and melee stop at
  // the world instead of passing straight through it.
  solidMeshes: THREE.Mesh[];
  bounds: CollisionBox;
  spawnPoints: THREE.Vector3[];
  playerStart: THREE.Vector3;
  // Drifts the ground-hugging mist patches; call every frame with elapsed
  // seconds.
  updateMist: (elapsed: number) => void;
}

const HALF_SIZE = 14;
const WALL_HEIGHT = 5;
const WALL_THICKNESS = 1;
const MIST_COUNT = 12;

function boxFromCenter(cx: number, cz: number, sx: number, sz: number): CollisionBox {
  return {
    minX: cx - sx / 2,
    maxX: cx + sx / 2,
    minZ: cz - sz / 2,
    maxZ: cz + sz / 2,
  };
}

// A soft radial-gradient sprite used for the ground mist patches — generated
// on a canvas so the game doesn't need an external image asset.
function createMistTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.22)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

export function buildArena(): ArenaBuildResult {
  const group = new THREE.Group();
  const collisionBoxes: CollisionBox[] = [];
  const solidMeshes: THREE.Mesh[] = [];

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2b2b31, roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_SIZE * 2 + 4, HALF_SIZE * 2 + 4), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x53545c, roughness: 0.85 });

  function addWall(cx: number, cz: number, sx: number, sz: number) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, WALL_HEIGHT, sz), wallMat);
    wall.position.set(cx, WALL_HEIGHT / 2, cz);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
    collisionBoxes.push(boxFromCenter(cx, cz, sx, sz));
    solidMeshes.push(wall);
  }

  addWall(0, -HALF_SIZE - WALL_THICKNESS / 2, HALF_SIZE * 2 + WALL_THICKNESS * 2, WALL_THICKNESS);
  addWall(0, HALF_SIZE + WALL_THICKNESS / 2, HALF_SIZE * 2 + WALL_THICKNESS * 2, WALL_THICKNESS);
  addWall(-HALF_SIZE - WALL_THICKNESS / 2, 0, WALL_THICKNESS, HALF_SIZE * 2);
  addWall(HALF_SIZE + WALL_THICKNESS / 2, 0, WALL_THICKNESS, HALF_SIZE * 2);

  const coverMat = new THREE.MeshStandardMaterial({ color: 0x3d3f46, roughness: 0.9 });
  const coverLayout: [number, number, number, number][] = [
    [-6, -4, 2.4, 2.4],
    [6, -3, 2, 3],
    [-3, 6, 3, 2],
    [4, 5, 2.2, 2.2],
    [0, -8, 4, 1.2],
  ];
  for (const [cx, cz, sx, sz] of coverLayout) {
    const h = 1.6;
    const box = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), coverMat);
    box.position.set(cx, h / 2, cz);
    box.castShadow = true;
    box.receiveShadow = true;
    group.add(box);
    collisionBoxes.push(boxFromCenter(cx, cz, sx, sz));
    solidMeshes.push(box);
  }

  // Ground-hugging mist: soft translucent patches drifting slowly across the
  // arena, low enough to read as fog pooling on the floor. Combined with the
  // tightened scene fog in main.ts, this is what the player's flashlight is
  // meant to cut through.
  const mistTexture = createMistTexture();
  const mistMat = new THREE.MeshBasicMaterial({
    map: mistTexture,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  interface MistPatch {
    mesh: THREE.Mesh;
    baseX: number;
    baseZ: number;
    speed: number;
    radius: number;
    phase: number;
  }
  const mistPatches: MistPatch[] = [];
  const mistGeo = new THREE.PlaneGeometry(1, 1);
  for (let i = 0; i < MIST_COUNT; i++) {
    const mesh = new THREE.Mesh(mistGeo, mistMat);
    const scale = 4 + Math.random() * 5;
    mesh.scale.set(scale, scale, 1);
    mesh.rotation.x = -Math.PI / 2;
    const baseX = (Math.random() - 0.5) * HALF_SIZE * 1.7;
    const baseZ = (Math.random() - 0.5) * HALF_SIZE * 1.7;
    mesh.position.set(baseX, 0.12 + Math.random() * 0.22, baseZ);
    mesh.renderOrder = 1;
    group.add(mesh);
    mistPatches.push({
      mesh,
      baseX,
      baseZ,
      speed: 0.12 + Math.random() * 0.18,
      radius: 1.5 + Math.random() * 2.5,
      phase: Math.random() * Math.PI * 2,
    });
  }
  function updateMist(elapsed: number) {
    for (const p of mistPatches) {
      p.mesh.position.x = p.baseX + Math.sin(elapsed * p.speed + p.phase) * p.radius;
      p.mesh.position.z = p.baseZ + Math.cos(elapsed * p.speed * 0.8 + p.phase) * p.radius;
      p.mesh.rotation.z = elapsed * 0.02 + p.phase;
    }
  }

  // Silent-Hill-dark: ambient is barely there. The player's flashlight (and
  // the fog it fights through) is meant to be almost the only light in the
  // room.
  const ambient = new THREE.AmbientLight(0x404858, 0.18);
  group.add(ambient);

  const hemi = new THREE.HemisphereLight(0x606a78, 0x0a0a0d, 0.14);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(0xd8dce8, 0.28);
  sun.position.set(10, 18, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -HALF_SIZE - 4;
  sun.shadow.camera.right = HALF_SIZE + 4;
  sun.shadow.camera.top = HALF_SIZE + 4;
  sun.shadow.camera.bottom = -HALF_SIZE - 4;
  sun.shadow.camera.far = 40;
  group.add(sun);

  const spawnPoints = [
    new THREE.Vector3(-HALF_SIZE + 1.5, 0, -HALF_SIZE + 1.5),
    new THREE.Vector3(HALF_SIZE - 1.5, 0, -HALF_SIZE + 1.5),
    new THREE.Vector3(-HALF_SIZE + 1.5, 0, HALF_SIZE - 1.5),
    new THREE.Vector3(HALF_SIZE - 1.5, 0, HALF_SIZE - 1.5),
    new THREE.Vector3(0, 0, -HALF_SIZE + 1.5),
    new THREE.Vector3(0, 0, HALF_SIZE - 1.5),
  ];

  return {
    group,
    collisionBoxes,
    solidMeshes,
    bounds: boxFromCenter(0, 0, HALF_SIZE * 2, HALF_SIZE * 2),
    spawnPoints,
    playerStart: new THREE.Vector3(0, 0, 0),
    updateMist,
  };
}

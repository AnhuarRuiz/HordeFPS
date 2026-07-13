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
  bounds: CollisionBox;
  spawnPoints: THREE.Vector3[];
  playerStart: THREE.Vector3;
}

const HALF_SIZE = 14;
const WALL_HEIGHT = 5;
const WALL_THICKNESS = 1;

function boxFromCenter(cx: number, cz: number, sx: number, sz: number): CollisionBox {
  return {
    minX: cx - sx / 2,
    maxX: cx + sx / 2,
    minZ: cz - sz / 2,
    maxZ: cz + sz / 2,
  };
}

export function buildArena(): ArenaBuildResult {
  const group = new THREE.Group();
  const collisionBoxes: CollisionBox[] = [];

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
  }

  const ambient = new THREE.AmbientLight(0x556070, 0.7);
  group.add(ambient);

  const hemi = new THREE.HemisphereLight(0x8899aa, 0x1a1a1f, 0.6);
  group.add(hemi);

  const sun = new THREE.DirectionalLight(0xffe8c0, 1.1);
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
    bounds: boxFromCenter(0, 0, HALF_SIZE * 2, HALF_SIZE * 2),
    spawnPoints,
    playerStart: new THREE.Vector3(0, 0, 0),
  };
}

import * as THREE from 'three';

// Anchored near a weapon's grip and running along +Z, back toward the viewer,
// so the forearm reads as an arm extended forward instead of dropping off-screen.
export function buildArm(): THREE.Group {
  const cuff = new THREE.MeshStandardMaterial({
    color: 0xe2e0dc,
    roughness: 0.7,
    emissive: 0x3c3b38,
    emissiveIntensity: 0.45,
  });
  const sleeve = new THREE.MeshStandardMaterial({
    color: 0x2f3238,
    roughness: 0.9,
    emissive: 0x15161a,
    emissiveIntensity: 0.5,
  });

  const armRoot = new THREE.Group();
  armRoot.position.set(0.055, -0.095, 0.05);
  armRoot.rotation.set(0.24, 0.34, -0.3);

  const cuffBand = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.086, 0.055), cuff);
  cuffBand.position.set(0, -0.01, 0.03);
  armRoot.add(cuffBand);

  const forearmLength = 0.62;
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.08, forearmLength), sleeve);
  forearm.position.set(0, -0.014, 0.058 + forearmLength / 2);
  armRoot.add(forearm);

  return armRoot;
}

// The off hand used during reloads to carry the magazine. Its origin is the
// fist (which grips the mag), with the forearm running down and out to the
// side toward the viewer, so the hand reads as reaching in from off screen.
export function buildReloadHand(): THREE.Group {
  const cuff = new THREE.MeshStandardMaterial({
    color: 0xe2e0dc,
    roughness: 0.7,
    emissive: 0x3c3b38,
    emissiveIntensity: 0.45,
  });
  const sleeve = new THREE.MeshStandardMaterial({
    color: 0x2f3238,
    roughness: 0.9,
    emissive: 0x15161a,
    emissiveIntensity: 0.5,
  });

  const root = new THREE.Group();

  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.062, 0.08), cuff);
  root.add(fist);

  const knuckles = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.026, 0.05), cuff);
  knuckles.position.set(0, 0.03, -0.02);
  root.add(knuckles);

  const forearmLength = 0.42;
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.072, forearmLength), sleeve);
  forearm.position.set(-0.06, -0.055, 0.03 + forearmLength / 2);
  forearm.rotation.set(0.28, 0.42, 0.28);
  root.add(forearm);

  return root;
}

// The support (left) hand that grips a rifle's handguard. Its origin sits at
// the grip point so callers can anchor it directly on the handguard; the fist
// wraps the origin and the forearm sweeps down-left back toward the viewer.
export function buildSupportArm(): THREE.Group {
  const cuff = new THREE.MeshStandardMaterial({
    color: 0xe2e0dc,
    roughness: 0.7,
    emissive: 0x3c3b38,
    emissiveIntensity: 0.45,
  });
  const sleeve = new THREE.MeshStandardMaterial({
    color: 0x2f3238,
    roughness: 0.9,
    emissive: 0x15161a,
    emissiveIntensity: 0.5,
  });

  const armRoot = new THREE.Group();
  // Angled so the forearm reads as coming up from the viewer's lower left onto
  // the foregrip (negative yaw swings the +Z forearm toward screen-left).
  armRoot.rotation.set(0.4, -0.5, 0.35);

  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.078, 0.07, 0.075), cuff);
  fist.position.set(0, -0.01, 0);
  armRoot.add(fist);

  const cuffBand = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.084, 0.05), cuff);
  cuffBand.position.set(0, -0.02, 0.06);
  armRoot.add(cuffBand);

  const forearmLength = 0.5;
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.078, forearmLength), sleeve);
  forearm.position.set(0, -0.02, 0.085 + forearmLength / 2);
  armRoot.add(forearm);

  return armRoot;
}

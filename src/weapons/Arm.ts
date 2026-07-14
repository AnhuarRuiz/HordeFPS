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

// A small handheld flashlight, built pointing down -Z (barrel convention) so
// it can be dropped into a fist alongside the same axis a gun barrel uses.
export function buildFlashlight(): THREE.Group {
  // Light enough to still read as a distinct object in this very dark scene —
  // a near-black flashlight simply vanishes against the background.
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x7d838c,
    roughness: 0.35,
    metalness: 0.8,
    emissive: 0x30343a,
    emissiveIntensity: 0.7,
  });
  const gripMat = new THREE.MeshStandardMaterial({
    color: 0x585d65,
    roughness: 0.55,
    metalness: 0.6,
    emissive: 0x25282d,
    emissiveIntensity: 0.7,
  });
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });

  const group = new THREE.Group();

  // Long enough that it still reads as a bar when viewed nearly end-on, which
  // is how the player sees it when it points downrange with the barrel.
  const bodyLen = 0.24;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, bodyLen, 10), gripMat);
  body.rotation.x = Math.PI / 2;
  group.add(body);

  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.01, 10), bodyMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0, 0.02 + i * 0.032);
    group.add(ring);
  }

  const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.023, 0.04, 10), bodyMat);
  bezel.rotation.x = Math.PI / 2;
  bezel.position.set(0, 0, -bodyLen / 2 - 0.018);
  group.add(bezel);

  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 12), lensMat);
  lens.position.set(0, 0, -bodyLen / 2 - 0.039);
  group.add(lens);

  const tailcap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.023, 0.026, 10), bodyMat);
  tailcap.rotation.x = Math.PI / 2;
  tailcap.position.set(0, 0, bodyLen / 2 + 0.011);
  group.add(tailcap);

  return group;
}

// Points an object's local -Z axis (its "forward", the way buildFlashlight and
// the forearm bar below are both authored) along `dir` in the parent's space.
// A quaternion avoids the rotation-order surprises of composing Euler angles.
function pointNegZAlong(object: THREE.Object3D, dir: THREE.Vector3) {
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir.clone().normalize());
}

// The Harries cross: from the fist, the support forearm runs back out to the
// viewer's LEFT and down, passing underneath the gun hand's wrist — so on
// screen the arm reads as coming in from the lower left, crossing right, up to
// the flashlight. One dead-straight bar.
const HARRIES_ARM_DIR = new THREE.Vector3(-1, -0.34, 0.5);

// The support hand in a Harries hold: the arm comes in straight from the
// right, the fist grips the flashlight, and the flashlight points dead ahead
// down the same line as the gun's barrel. Origin is the fist.
export function buildHarriesHand(): THREE.Group {
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

  // Fist, wrist and forearm all live in one group turned to face down the arm,
  // so they stack along a single axis and read as one continuous limb. Mixing a
  // world-aligned fist with a rotated forearm is what produced the notched,
  // crumpled silhouette: two boxes meeting at an angle always crease.
  const limb = new THREE.Group();
  pointNegZAlong(limb, HARRIES_ARM_DIR);
  root.add(limb);

  // Inside `limb`, -Z runs out toward the elbow and +Z toward the knuckles.
  const fist = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.078, 0.105), cuff);
  limb.add(fist);

  const cuffBand = new THREE.Mesh(new THREE.BoxGeometry(0.076, 0.07, 0.04), cuff);
  cuffBand.position.z = -0.07;
  limb.add(cuffBand);

  const forearmLength = 0.44;
  const forearmGeo = new THREE.BoxGeometry(0.066, 0.06, forearmLength);
  forearmGeo.translate(0, 0, -forearmLength / 2);
  const forearm = new THREE.Mesh(forearmGeo, sleeve);
  forearm.position.z = -0.06;
  limb.add(forearm);

  // Flashlight held in the fist pointing dead ahead — buildFlashlight already
  // faces -Z, the same way the gun's barrel does, so it needs no rotation at
  // all. Because it points straight away from the camera it would sit fully
  // end-on and hidden behind the fist, so it's dropped below and pushed
  // forward: the fist reads as wrapping its top while the body stays a
  // visible bar running downrange.
  const flashlight = buildFlashlight();
  flashlight.position.set(0.012, -0.045, -0.11);
  root.add(flashlight);

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

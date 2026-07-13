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

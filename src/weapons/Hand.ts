import * as THREE from 'three';

// A first-person forearm + hand, built once and reused by the crawl and mantle
// viewmodels. Deliberately ONE short forearm segment plus an actual hand (palm,
// four fingers, thumb) rather than the long two-bar "arm" the earlier versions
// used — two long boxes nearly in a line, scaled up and jammed against the
// camera, is exactly what read as a straight, over-long, weird limb. Here the
// elbow is off-screen (as it is in most FPS views) and what you see is a
// forearm coming in from the frame edge with a real hand at the end.
//
// Local convention: -Z points toward the fingertips (forward), +Z back toward
// the off-screen elbow, and -Y is the palm-down direction.
const SKIN_COLOR = 0xcaa588;
const SLEEVE_COLOR = 0x2f3238;
const CUFF_COLOR = 0xe2e0dc;

export interface HandParts {
  group: THREE.Group;
  // Finger group, exposed so callers can animate a grip curl (0 = open/flat,
  // 1 = curled over an edge) per frame.
  fingers: THREE.Group;
}

export function buildForearmHand(): HandParts {
  // Emissive is pushed up because the flashlight is holstered whenever these
  // hands are shown (crawling or climbing), so in this near-black scene their
  // own glow plus the small fill light is all that keeps them readable.
  const skin = new THREE.MeshStandardMaterial({
    color: SKIN_COLOR,
    roughness: 0.85,
    emissive: 0x4a3a2c,
    emissiveIntensity: 0.75,
  });
  const sleeve = new THREE.MeshStandardMaterial({
    color: SLEEVE_COLOR,
    roughness: 0.9,
    emissive: 0x2a2d33,
    emissiveIntensity: 0.7,
  });
  const cuff = new THREE.MeshStandardMaterial({
    color: CUFF_COLOR,
    roughness: 0.7,
    emissive: 0x5a564e,
    emissiveIntensity: 0.7,
  });

  const group = new THREE.Group();

  // Short forearm running back toward the off-screen elbow (+Z).
  const foreLen = 0.3;
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.072, foreLen), sleeve);
  forearm.position.set(0, 0, foreLen / 2 - 0.01);
  group.add(forearm);

  // Sleeve cuff at the wrist.
  const cuffBand = new THREE.Mesh(new THREE.BoxGeometry(0.076, 0.08, 0.05), cuff);
  cuffBand.position.set(0, 0, 0.02);
  group.add(cuffBand);

  // Palm — flat (thin in Y), reaching forward of the wrist.
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.03, 0.085), skin);
  palm.position.set(0, 0, -0.05);
  group.add(palm);

  // Four fingers in their own group so they can curl together to grip.
  const fingers = new THREE.Group();
  fingers.position.set(0, 0, -0.092); // hinge at the knuckle line, front of palm
  const fingerX = [-0.028, -0.0095, 0.0095, 0.028];
  for (const fx of fingerX) {
    const finger = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.019, 0.052), skin);
    finger.position.set(fx, 0, -0.026);
    fingers.add(finger);
  }
  group.add(fingers);

  // Thumb along the +X side, angled inward across the palm.
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.017, 0.019, 0.044), skin);
  thumb.position.set(0.048, 0.002, -0.04);
  thumb.rotation.y = -0.6;
  group.add(thumb);

  return { group, fingers };
}

// Curl the fingers down/under the knuckle line. 0 = flat, 1 = fully curled (as
// when gripping the top edge of a ledge). Negative X rotation tips the -Z
// fingertips toward -Y (down), curling over a front edge.
export function setGrip(fingers: THREE.Group, curl: number) {
  fingers.rotation.x = -curl * 1.5;
}

// Draw a viewmodel hand rig over the world with no depth test — the standard
// FPS trick so hands pressed right up against the ground or a ledge aren't
// swallowed by it. Applied to every mesh under `group`.
export function makeOverlayViewmodel(group: THREE.Object3D) {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.renderOrder = 20;
    const mat = mesh.material as THREE.Material;
    mat.depthTest = false;
    mat.depthWrite = false;
  });
}

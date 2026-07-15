import * as THREE from 'three';

// A first-person forearm + hand, built once and reused by the crawl and mantle
// viewmodels. ONE short forearm segment plus an actual hand (palm, four fingers,
// thumb) rather than the long two-bar "arm" earlier versions used.
//
// Local convention: -Z points toward the fingertips (forward), +Z back toward
// the off-screen elbow, and -Y is the palm-down direction.
const SKIN_COLOR = 0xc39d80;
const SLEEVE_COLOR = 0x33363d;
const CUFF_COLOR = 0x44474e;

// Dedicated render layer for hand viewmodels. main.ts draws this layer in a
// second pass with a cleared depth buffer, so the hands (a) always draw over
// the world instead of being swallowed by the floor/ledge they're pressed
// against, and (b) still depth-test against THEMSELVES so the palm correctly
// hides the fingers behind it — the plain "depthTest off" approach broke that,
// making the hand look transparent/see-through.
export const VIEWMODEL_LAYER = 1;

export interface HandParts {
  group: THREE.Group;
  // Finger group, exposed so callers can animate a grip curl (0 = open/flat,
  // 1 = curled over an edge) per frame.
  fingers: THREE.Group;
  // Wrist joint holding the palm/fingers/thumb, so callers can bend the hand
  // relative to the forearm — how the mantle keeps the hand palm-DOWN (fingers
  // curling down over a ledge) while the forearm angles up.
  wrist: THREE.Group;
}

export function buildForearmHand(): HandParts {
  const skin = new THREE.MeshStandardMaterial({
    color: SKIN_COLOR,
    roughness: 0.85,
    emissive: 0x3a2c20,
    emissiveIntensity: 0.5,
  });
  const sleeve = new THREE.MeshStandardMaterial({
    color: SLEEVE_COLOR,
    roughness: 0.9,
    emissive: 0x22252b,
    emissiveIntensity: 0.5,
  });
  const cuff = new THREE.MeshStandardMaterial({
    color: CUFF_COLOR,
    roughness: 0.8,
    emissive: 0x25272c,
    emissiveIntensity: 0.5,
  });

  const group = new THREE.Group();

  // Short, slim forearm running back toward the off-screen elbow (+Z). Kept dark
  // and modest so it reads as a sleeve, not a big pale slab.
  const foreLen = 0.2;
  const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.062, foreLen), sleeve);
  forearm.position.set(0, 0, foreLen / 2);
  group.add(forearm);

  // A slim cuff band at the wrist (dark, not a bright white block).
  const cuffBand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.072, 0.035), cuff);
  cuffBand.position.set(0, 0, 0.012);
  group.add(cuffBand);

  // Everything past the wrist lives under this joint so the hand can bend
  // relative to the forearm.
  const wrist = new THREE.Group();
  group.add(wrist);

  // Palm — a solid block with real thickness so the hand has mass and the
  // fingers read as extending from its front rather than floating above it.
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.052, 0.1), skin);
  palm.position.set(0, 0, -0.058);
  wrist.add(palm);

  // Four fingers in their own group so they can curl together to grip. Centred
  // on the palm's own Y so they sit flush with it (at the middle of the hand),
  // not perched on top.
  const fingers = new THREE.Group();
  fingers.position.set(0, 0, -0.108); // hinge at the knuckle line, front of palm
  const fingerX = [-0.03, -0.01, 0.01, 0.03];
  for (const fx of fingerX) {
    const finger = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.024, 0.055), skin);
    finger.position.set(fx, 0, -0.028);
    fingers.add(finger);
  }
  wrist.add(fingers);

  // Thumb along the +X side, angled inward across the palm.
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.019, 0.023, 0.05), skin);
  thumb.position.set(0.05, -0.004, -0.05);
  thumb.rotation.y = -0.6;
  wrist.add(thumb);

  return { group, fingers, wrist };
}

// Curl the fingers down/under the knuckle line. 0 = flat, 1 = fully curled.
// Negative X rotation tips the -Z fingertips toward -Y (down), curling over a
// front edge.
export function setGrip(fingers: THREE.Group, curl: number) {
  fingers.rotation.x = -curl * 1.5;
}

// Put a hand rig on the dedicated viewmodel layer (see VIEWMODEL_LAYER). Depth
// testing/writing stays ON so the hand self-occludes correctly; the second
// render pass in main.ts is what keeps it drawing over the world.
export function markViewmodel(group: THREE.Object3D) {
  group.traverse((o) => o.layers.set(VIEWMODEL_LAYER));
}

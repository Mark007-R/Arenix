/**
 * Blocky, jointed low-poly contestants with outlined edges (the "drafting" look).
 *
 * A figure is a tree of pivot groups (hips → torso → shoulders → arms, hips → thighs → shins) so
 * walk, idle, aim and death poses are just joint rotations. One world unit is one map tile; a
 * figure is about 1.3 units tall.
 */
import * as THREE from "three";
import type { Cosmetics } from "../archetypes";
import { OUTFITS } from "./palette3d";

const EDGE = new THREE.LineBasicMaterial({ color: 0x2e2b27, transparent: true, opacity: 0.55 });
const materials = new Map<string, THREE.MeshLambertMaterial>();

export function mat(color: string, opacity = 1): THREE.MeshLambertMaterial {
  const key = `${color}/${opacity}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity, flatShading: true });
    materials.set(key, m);
  }
  return m;
}

const boxes = new Map<string, { geo: THREE.BoxGeometry; edges: THREE.EdgesGeometry }>();
function boxGeo(w: number, h: number, d: number) {
  const key = `${w}/${h}/${d}`;
  let g = boxes.get(key);
  if (!g) {
    const geo = new THREE.BoxGeometry(w, h, d);
    g = { geo, edges: new THREE.EdgesGeometry(geo) };
    boxes.set(key, g);
  }
  return g;
}

/** A box with dark outline edges; `y0` is the bottom of the box relative to its parent. */
export function block(
  w: number, h: number, d: number, color: string, x = 0, y0 = 0, z = 0, outline = true, opacity = 1,
): THREE.Mesh {
  const g = boxGeo(w, h, d);
  const mesh = new THREE.Mesh(g.geo, mat(color, opacity));
  mesh.position.set(x, y0 + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (outline) mesh.add(new THREE.LineSegments(g.edges, EDGE));
  return mesh;
}

function pivot(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export interface Figure {
  root: THREE.Group;
  body: THREE.Group;
  /** Advance the animation. `speed` is 0 (idle) to 1 (full walk). */
  animate(dt: number, speed: number, opts: { aim: boolean; reduced: boolean }): void;
  setGhost(ghost: boolean): void;
  setDead(dead: boolean): void;
  dispose(): void;
}

const HELMET_STYLES = new Set(["helm", "crown", "wild"]);

function headgear(head: THREE.Group, style: string, outfit: (typeof OUTFITS)[string], hat?: string): void {
  const helmet = outfit.vest;
  switch (hat ?? style) {
    case "wizard":
    case "wizard_hat": {
      head.add(block(0.4, 0.06, 0.4, helmet, 0, 0.22));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.36, 5), mat(helmet));
      cone.position.set(0, 0.46, 0);
      cone.castShadow = true;
      cone.add(new THREE.LineSegments(new THREE.EdgesGeometry(cone.geometry), EDGE));
      head.add(cone);
      break;
    }
    case "hood":
    case "hoodMask":
      head.add(block(0.36, 0.28, 0.36, helmet, 0, 0.0, -0.02));
      if (style === "hoodMask") head.add(block(0.3, 0.08, 0.04, "#3a3630", 0, 0.05, 0.17));
      break;
    case "crown":
      head.add(block(0.3, 0.08, 0.3, outfit.accent, 0, 0.24));
      for (const [x, z] of [[-0.11, -0.11], [0.11, -0.11], [-0.11, 0.11], [0.11, 0.11]] as const) {
        head.add(block(0.05, 0.08, 0.05, outfit.accent, x, 0.32, z, false));
      }
      break;
    case "leaf":
      head.add(block(0.36, 0.08, 0.36, outfit.accent, 0, 0.2));
      head.add(block(0.08, 0.14, 0.2, outfit.accent, 0, 0.26, 0, false));
      break;
    case "goblin":
      head.add(block(0.2, 0.06, 0.06, "#7f9a52", -0.22, 0.08, 0, false));
      head.add(block(0.2, 0.06, 0.06, "#7f9a52", 0.22, 0.08, 0, false));
      head.add(block(0.32, 0.1, 0.32, helmet, 0, 0.18));
      break;
    default:
      // Helmet with a little antenna, like the screenshots' squad.
      head.add(block(0.38, 0.16, 0.38, helmet, 0, 0.12));
      if (HELMET_STYLES.has(style)) head.add(block(0.03, 0.18, 0.03, "#3a3630", 0.12, 0.26, -0.12, false));
  }
}

export function buildFigure(archetype: string, cosmetics?: Cosmetics): Figure {
  const base = OUTFITS[archetype] ?? OUTFITS.knight!;
  // Cosmetic skins recolour the vest and trim; hats replace the headgear.
  const outfit = cosmetics?.skin
    ? { ...base, vest: cosmetics.skin.tunic, accent: cosmetics.skin.accent }
    : base;
  const suit = outfit.suit;
  const dark = "#4a4640";

  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0); // tilts on death, bobs while walking
  const hips = pivot(body, 0, 0.62, 0);

  // Legs: thigh pivot at the hip, shin pivot at the knee.
  const legs = [-1, 1].map((side) => {
    const thigh = pivot(hips, side * 0.11, 0, 0);
    thigh.add(block(0.15, 0.3, 0.16, suit, 0, -0.3));
    thigh.add(block(0.16, 0.08, 0.17, outfit.vest, 0, -0.2)); // knee pad strap
    const shin = pivot(thigh, 0, -0.3, 0);
    shin.add(block(0.14, 0.28, 0.15, suit, 0, -0.28));
    shin.add(block(0.16, 0.06, 0.24, dark, 0, -0.32, 0.03)); // boot
    return { thigh, shin };
  });

  // Torso with a vest, belt and backpack.
  const torso = pivot(hips, 0, 0, 0);
  torso.add(block(0.36, 0.42, 0.22, suit, 0, 0.0));
  torso.add(block(0.38, 0.3, 0.25, outfit.vest, 0, 0.1));
  torso.add(block(0.38, 0.06, 0.24, dark, 0, 0.0));
  torso.add(block(0.28, 0.3, 0.12, outfit.vest, 0, 0.08, -0.17)); // pack
  torso.add(block(0.08, 0.08, 0.04, outfit.accent, 0.1, 0.28, 0.13, false)); // badge

  const head = pivot(torso, 0, 0.48, 0);
  head.add(block(0.28, 0.26, 0.28, suit, 0, 0.0));
  head.add(block(0.2, 0.08, 0.04, "#3a3630", 0, 0.12, 0.14, false)); // visor
  headgear(head, outfit.head, outfit, cosmetics?.hat?.style);

  // Arms: shoulder pivots, elbow pivots; the right hand holds a tool/weapon.
  const arms = [-1, 1].map((side) => {
    const shoulder = pivot(torso, side * 0.25, 0.4, 0);
    shoulder.add(block(0.12, 0.24, 0.13, suit, 0, -0.24));
    shoulder.add(block(0.14, 0.08, 0.15, outfit.vest, 0, -0.08)); // shoulder pad
    const elbow = pivot(shoulder, 0, -0.24, 0);
    elbow.add(block(0.11, 0.22, 0.12, suit, 0, -0.22));
    return { shoulder, elbow };
  });
  const tool = block(0.05, 0.05, 0.5, dark, 0, -0.22, 0.22, false);
  arms[1]!.elbow.add(tool);

  let t = Math.random() * 10;
  let ghost = false;
  let dead = false;
  let aimBlend = 0;

  function animate(dt: number, speed: number, opts: { aim: boolean; reduced: boolean }): void {
    if (dead) return;
    t += dt * (opts.reduced ? 0.5 : 1);
    aimBlend += ((opts.aim ? 1 : 0) - aimBlend) * Math.min(1, dt * 10);
    const stride = Math.sin(t * 9) * speed;
    const lift = Math.max(0, Math.sin(t * 9)) * speed;
    const liftB = Math.max(0, -Math.sin(t * 9)) * speed;
    legs[0]!.thigh.rotation.x = stride * 0.6;
    legs[1]!.thigh.rotation.x = -stride * 0.6;
    legs[0]!.shin.rotation.x = -liftB * 0.9 - 0.05;
    legs[1]!.shin.rotation.x = -lift * 0.9 - 0.05;
    const breathe = opts.reduced ? 0 : Math.sin(t * 2) * 0.015;
    body.position.y = (opts.reduced ? 0 : Math.abs(Math.cos(t * 9)) * 0.05 * speed) + (ghost ? 0.15 + Math.sin(t * 2) * 0.05 : 0);
    torso.rotation.x = 0.08 * speed + breathe;
    torso.rotation.y = Math.sin(t * 9) * 0.08 * speed;
    // Arms swing while walking and come up to a two-handed "ready" pose when aiming.
    const swing = -stride * 0.5;
    const [left, right] = arms as [typeof arms[0], typeof arms[0]];
    left.shoulder.rotation.x = swing * (1 - aimBlend) - 1.25 * aimBlend;
    left.shoulder.rotation.z = 0.05 + 0.35 * aimBlend;
    left.elbow.rotation.x = -0.3 - 0.4 * aimBlend;
    right.shoulder.rotation.x = -swing * (1 - aimBlend) - 1.35 * aimBlend;
    right.shoulder.rotation.z = -0.05;
    right.elbow.rotation.x = -0.5 * (1 - aimBlend) - 0.2 * aimBlend;
    head.rotation.y = Math.sin(t * 0.7) * 0.15 * (1 - speed) * (opts.reduced ? 0 : 1);
  }

  function setOpacity(opacity: number): void {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.MeshLambertMaterial;
        o.material = mat(`#${m.color.getHexString()}`, opacity);
        o.castShadow = opacity === 1;
      }
    });
  }

  return {
    root,
    body,
    animate,
    setGhost(g: boolean) {
      if (g === ghost) return;
      ghost = g;
      setOpacity(g ? 0.35 : 1);
    },
    setDead(d: boolean) {
      if (d === dead) return;
      dead = d;
      // Fall onto the back, limbs splayed.
      body.rotation.x = d ? -Math.PI / 2 : 0;
      body.position.y = d ? 0.16 : 0;
      legs[0]!.thigh.rotation.set(0, 0, d ? 0.25 : 0);
      legs[1]!.thigh.rotation.set(0, 0, d ? -0.25 : 0);
      arms[0]!.shoulder.rotation.set(0, 0, d ? 1.1 : 0);
      arms[1]!.shoulder.rotation.set(0, 0, d ? -1.1 : 0);
    },
    dispose() {
      root.removeFromParent();
    },
  };
}

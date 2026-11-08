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
  /** Play a one-off action: this archetype's attack, a gathering swing, or a little cheer. */
  perform(action: Action): void;
  /** How this archetype attacks (decides the motion and the hit effect). */
  readonly style: StrikeStyle;
  dispose(): void;
}

export type Action = "strike" | "gather" | "cheer";
export type StrikeStyle = "chop" | "slash" | "spin" | "stab" | "draw" | "cast" | "sweep";

export const STRIKE_STYLE: Record<string, StrikeStyle> = {
  warrior: "chop",
  knight: "slash",
  champion: "spin",
  rogue: "stab",
  archer: "draw",
  trickster: "draw",
  wizard: "cast",
  guardian: "sweep",
};

/** Seconds into a strike when the blow lands (the hit effect starts then). */
export const IMPACT: Record<StrikeStyle, number> = {
  chop: 0.33, slash: 0.4, spin: 0.55, stab: 0.2, draw: 0.48, cast: 0.42, sweep: 0.45,
};

// One pose of the action keyframes: right/left shoulder (x, z), elbows (x), torso (x, y), body lift.
interface Pose { rsx: number; rsz: number; rex: number; lsx: number; lsz: number; lex: number; tx: number; ty: number; by: number }
const N: Pose = { rsx: 0, rsz: -0.05, rex: -0.5, lsx: 0, lsz: 0.05, lex: -0.3, tx: 0, ty: 0, by: 0 };
const P = (o: Partial<Pose>): Pose => ({ ...N, ...o });

// Keyframes as [time 0..1, pose]; every action starts and ends at the neutral pose.
const MOVES: Record<StrikeStyle | "gather" | "cheer", { dur: number; keys: [number, Pose][] }> = {
  chop: { dur: 0.75, keys: [[0, N], [0.38, P({ rsx: -2.9, rex: -0.2, lsx: -0.5, tx: -0.15 })], [0.5, P({ rsx: -0.4, rex: -0.1, lsx: -0.7, tx: 0.3 })], [0.75, P({ rsx: -0.4, rex: -0.1, tx: 0.25 })], [1, N]] },
  slash: { dur: 0.75, keys: [[0, N], [0.35, P({ rsx: -1.6, rsz: 1.1, ty: 0.55 })], [0.55, P({ rsx: -1.4, rsz: -1.1, ty: -0.65 })], [0.78, P({ rsx: -1.2, rsz: -1.0, ty: -0.5 })], [1, N]] },
  spin: { dur: 0.95, keys: [[0, N], [0.25, P({ rsx: -1.5, rsz: -1.3, lsz: 1.3 })], [0.75, P({ rsx: -1.5, rsz: -1.3, lsz: 1.3, ty: -Math.PI * 2, by: 0.12 })], [1, P({ ty: -Math.PI * 2 })]] },
  stab: { dur: 0.75, keys: [[0, N], [0.22, P({ rsx: -1.6, rex: 0, tx: 0.3 })], [0.38, P({ rsx: -0.8, rex: -0.9, tx: 0.1 })], [0.58, P({ lsx: -1.6, lex: 0, tx: 0.3 })], [0.78, P({ lsx: -0.8, lex: -0.9 })], [1, N]] },
  draw: { dur: 0.85, keys: [[0, N], [0.3, P({ rsx: -1.5, rex: 0, lsx: -1.5, lsz: 0.45, lex: -1.7 })], [0.55, P({ rsx: -1.5, rex: 0, lsx: -1.5, lsz: 0.45, lex: -1.8 })], [0.6, P({ rsx: -1.5, rex: 0, lsx: -1.3, lsz: 0.3, lex: -0.2 })], [0.85, P({ rsx: -1.4, rex: -0.1, lsx: -1.0 })], [1, N]] },
  cast: { dur: 0.85, keys: [[0, N], [0.35, P({ rsx: -3.0, rex: -0.1, lsx: -1.2, tx: -0.1 })], [0.5, P({ rsx: -1.6, rex: 0, lsx: -1.0, tx: 0.2 })], [0.8, P({ rsx: -1.5, rex: 0, tx: 0.15 })], [1, N]] },
  sweep: { dur: 0.8, keys: [[0, N], [0.35, P({ rsx: -1.1, rsz: 1.0, ty: 0.6, tx: 0.2 })], [0.6, P({ rsx: -1.0, rsz: -1.1, ty: -0.7, tx: 0.25 })], [0.8, P({ rsx: -0.9, rsz: -0.9, ty: -0.5 })], [1, N]] },
  gather: { dur: 0.9, keys: [[0, N], [0.22, P({ rsx: -2.0, tx: -0.05 })], [0.42, P({ rsx: -0.3, tx: 0.25 })], [0.62, P({ rsx: -2.0 })], [0.82, P({ rsx: -0.3, tx: 0.25 })], [1, N]] },
  cheer: { dur: 0.8, keys: [[0, N], [0.3, P({ rsx: -3.0, lsx: -3.0, by: 0.25 })], [0.55, P({ rsx: -2.8, lsx: -2.8, by: 0 })], [0.75, P({ rsx: -3.0, lsx: -3.0, by: 0.12 })], [1, N]] },
};

function samplePose(keys: [number, Pose][], u: number): Pose {
  let i = 0;
  while (i < keys.length - 2 && u > keys[i + 1]![0]) i++;
  const [u0, a] = keys[i]!;
  const [u1, b] = keys[i + 1]!;
  const k = Math.min(1, Math.max(0, (u - u0) / Math.max(1e-6, u1 - u0)));
  const e = k * k * (3 - 2 * k);
  const out = {} as Pose;
  for (const key of Object.keys(N) as (keyof Pose)[]) out[key] = a[key] + (b[key] - a[key]) * e;
  return out;
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

const STEEL = "#d9dde3";
const STEEL_DARK = "#9aa3ad";
const GOLD = "#f2b134";
const WOOD = "#a8693f";
const GRIP = "#4a3a30";

/** A short sword or dagger along +z from the grip. */
function blade(hand: THREE.Object3D, length: number, color = STEEL, guard = STEEL_DARK): void {
  hand.add(block(0.045, 0.045, 0.12, GRIP, 0, -0.022, 0));
  hand.add(block(0.16, 0.04, 0.04, guard, 0, -0.02, 0.07));
  hand.add(block(0.05, 0.022, length, color, 0, -0.011, 0.09 + length / 2));
}

/** Each archetype carries its own gear (cosmetic only; every contestant plays the same). */
function arm(
  archetype: string, left: THREE.Object3D, right: THREE.Object3D, torso: THREE.Object3D, outfit: (typeof OUTFITS)[string],
): void {
  switch (archetype) {
    case "warrior": {
      // Battle axe: long handle with a broad steel head.
      right.add(block(0.05, 0.05, 0.62, WOOD, 0, -0.025, 0.2));
      right.add(block(0.04, 0.24, 0.16, STEEL, 0, -0.04, 0.44));
      right.add(block(0.045, 0.06, 0.06, STEEL_DARK, 0, -0.03, 0.52));
      break;
    }
    case "archer": {
      // Bow in the right hand, a quiver of arrows on the back.
      const bow = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.022, 4, 14, Math.PI), mat(WOOD));
      bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
      bow.position.set(0, 0, 0.04);
      bow.castShadow = true;
      right.add(bow);
      const string = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.6, 0.008), mat("#f4ead2"));
      string.position.set(0, 0, 0.04);
      right.add(string);
      torso.add(block(0.12, 0.34, 0.1, "#8a5a3c", 0.09, 0.05, -0.2));
      for (const x of [0.06, 0.1, 0.13]) torso.add(block(0.02, 0.1, 0.02, outfit.accent, x, 0.38, -0.2, false));
      break;
    }
    case "wizard": {
      // Tall staff topped with a glowing gem.
      right.add(block(0.045, 0.045, 1.0, WOOD, 0, -0.022, 0.15));
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.09),
        new THREE.MeshLambertMaterial({ color: outfit.accent, emissive: outfit.accent, emissiveIntensity: 0.7, flatShading: true }),
      );
      gem.position.set(0, 0, 0.72);
      right.add(gem);
      break;
    }
    case "rogue":
      // Twin daggers.
      blade(right, 0.24);
      blade(left, 0.2);
      break;
    case "guardian": {
      // A living wooden staff, sprouting leaves.
      right.add(block(0.05, 0.05, 0.95, "#7a4e30", 0, -0.025, 0.15));
      right.add(block(0.14, 0.1, 0.14, outfit.accent, 0, -0.03, 0.66));
      right.add(block(0.1, 0.08, 0.1, "#5fb04f", 0.06, 0.04, 0.6));
      break;
    }
    case "knight":
      // Sword and a shield in the house colours.
      blade(right, 0.5);
      left.add(block(0.05, 0.36, 0.3, outfit.vest, -0.05, -0.18, 0.06));
      left.add(block(0.055, 0.16, 0.06, outfit.accent, -0.06, -0.08, 0.06, false));
      left.add(block(0.055, 0.06, 0.16, outfit.accent, -0.06, -0.03, 0.06, false));
      break;
    case "trickster": {
      // Slingshot: a forked stick with a band.
      right.add(block(0.04, 0.04, 0.18, WOOD, 0, -0.02, 0.06));
      right.add(block(0.035, 0.035, 0.16, WOOD, -0.05, -0.018, 0.2));
      right.add(block(0.035, 0.035, 0.16, WOOD, 0.05, -0.018, 0.2));
      right.add(block(0.11, 0.015, 0.015, "#e05a47", 0, -0.008, 0.27, false));
      break;
    }
    case "champion":
      // A golden sword with a ruby on the guard.
      blade(right, 0.55, GOLD, "#d64545");
      break;
    default:
      blade(right, 0.4);
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
  // Hands: weapons are built pointing forward (+z) from the grip and tilted up a little.
  const hands = arms.map((a) => {
    const hand = pivot(a.elbow, 0, -0.23, 0.02);
    hand.rotation.x = -0.45;
    return hand;
  });
  arm(archetype, hands[0]!, hands[1]!, torso, outfit);

  let t = Math.random() * 10;
  let action: { move: (typeof MOVES)[keyof typeof MOVES]; time: number } | null = null;
  const style: StrikeStyle = STRIKE_STYLE[archetype] ?? "slash";
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
    // A one-off action (attack, gathering swing, cheer) overrides the arms and torso while it plays.
    if (action) {
      action.time += dt;
      const u = action.time / action.move.dur;
      if (u >= 1 || opts.reduced) {
        action = null;
      } else {
        const q = samplePose(action.move.keys, u);
        right.shoulder.rotation.x = q.rsx;
        right.shoulder.rotation.z = q.rsz;
        right.elbow.rotation.x = q.rex;
        left.shoulder.rotation.x = q.lsx;
        left.shoulder.rotation.z = q.lsz;
        left.elbow.rotation.x = q.lex;
        torso.rotation.x += q.tx;
        torso.rotation.y += q.ty;
        body.position.y += q.by;
      }
    }
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
    style,
    perform(a: Action) {
      if (dead) return;
      action = { move: MOVES[a === "strike" ? style : a], time: 0 };
    },
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

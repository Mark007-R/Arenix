/**
 * Builds the 3D island from the server's map: a painted ground plane, instanced low-poly walls,
 * rocks, ruins and trees (with outlines), and simple models for every map object.
 *
 * Coordinates: one unit per tile; map x → world x, map y → world z, up is +y.
 */
import * as THREE from "three";
import type { MapDTO, MapObjectDTO } from "@/shared/protocol";
import { block, mat } from "./figure";
import { isoPalette, TILE, type IsoPalette } from "./palette3d";

/** Shared uniforms for the "see-through" hole around the player (walls and trees in front fade). */
export const XRAY = {
  uXrayPos: { value: new THREE.Vector2(-9999, -9999) },
  uXrayR: { value: 0 },
  uXrayDepth: { value: 0 },
};

/** Patch a material so fragments in front of the player, near them on screen, are dithered away. */
export function xray<M extends THREE.Material>(m: M): M {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, XRAY);
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      `uniform vec2 uXrayPos; uniform float uXrayR; uniform float uXrayDepth;
void main() {
  if (uXrayR > 0.0 && gl_FragCoord.z < uXrayDepth) {
    float dist = distance(gl_FragCoord.xy, uXrayPos);
    if (dist < uXrayR) {
      float n = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
      if (n < 0.8 - 0.6 * smoothstep(uXrayR * 0.6, uXrayR, dist)) discard;
    }
  }`,
    );
  };
  m.customProgramCacheKey = () => "xray";
  return m;
}

function hash(x: number, y: number, salt = 0): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

export interface WorldHandles {
  root: THREE.Group;
  nodes: Map<string, { full: THREE.Object3D; empty: THREE.Object3D }>;
  beacons: Map<string, { lit: THREE.Object3D; flame: THREE.Mesh }>;
  tower: { ruined: THREE.Object3D; repaired: THREE.Object3D; top: number } | null;
  objects: Map<string, MapObjectDTO>;
  dispose(): void;
}

const PX = 16; // ground texture pixels per tile

function groundTexture(map: MapDTO, p: IsoPalette): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = map.width * PX;
  c.height = map.height * PX;
  const g = c.getContext("2d")!;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.tiles[y * map.width + x]!;
      const base = new THREE.Color(p.floor[t] ?? p.paper);
      // Tiny per-tile variation keeps large areas from looking flat.
      base.offsetHSL(0, 0, (hash(x, y) - 0.5) * 0.025);
      g.fillStyle = `#${base.getHexString()}`;
      g.fillRect(x * PX, y * PX, PX, PX);
      if (t === TILE.FLOWERS) {
        g.fillStyle = p.canopy[2]!;
        for (let i = 0; i < 3; i++) g.fillRect(x * PX + hash(x, y, i) * 13, y * PX + hash(x, y, i + 5) * 13, 2, 2);
      }
      if (t === TILE.WATER) {
        g.fillStyle = "rgba(255,255,255,0.18)";
        if (hash(x, y, 9) > 0.6) g.fillRect(x * PX + 3, y * PX + 7, 8, 1);
      }
      if (t === TILE.BRIDGE) {
        g.fillStyle = "rgba(0,0,0,0.12)";
        for (let i = 4; i < PX; i += 5) g.fillRect(x * PX, y * PX + i, PX, 1);
      }
    }
  }
  // Tile grid, like drafting paper.
  g.strokeStyle = "rgba(60,55,48,0.10)";
  g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x <= map.width; x++) {
    g.moveTo(x * PX + 0.5, 0);
    g.lineTo(x * PX + 0.5, c.height);
  }
  for (let y = 0; y <= map.height; y++) {
    g.moveTo(0, y * PX + 0.5);
    g.lineTo(c.width, y * PX + 0.5);
  }
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

function paperTexture(p: IsoPalette): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = p.paper;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = p.grid;
  g.lineWidth = 1;
  for (let i = 0; i <= 128; i += 16) {
    g.globalAlpha = i % 64 === 0 ? 0.9 : 0.45;
    g.beginPath();
    g.moveTo(i + 0.5, 0);
    g.lineTo(i + 0.5, 128);
    g.moveTo(0, i + 0.5);
    g.lineTo(128, i + 0.5);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Instanced boxes + one merged outline mesh for a list of tile boxes. */
function instancedBoxes(
  items: { x: number; z: number; w: number; h: number; d: number; y?: number; color: string; rot?: number }[],
  castShadow = true,
): THREE.Object3D {
  const group = new THREE.Group();
  if (!items.length) return group;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const material = xray(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }));
  const mesh = new THREE.InstancedMesh(geo, material, items.length);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const color = new THREE.Color();
  const edges = new THREE.EdgesGeometry(geo).attributes.position!.array as Float32Array;
  const lines = new Float32Array(items.length * edges.length);
  const v = new THREE.Vector3();
  items.forEach((it, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot ?? 0);
    s.set(it.w, it.h, it.d);
    pos.set(it.x, (it.y ?? 0) + it.h / 2, it.z);
    m.compose(pos, q, s);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color.set(it.color));
    for (let k = 0; k < edges.length; k += 3) {
      v.set(edges[k]!, edges[k + 1]!, edges[k + 2]!).applyMatrix4(m);
      lines.set([v.x, v.y, v.z], i * edges.length + k);
    }
  });
  group.add(mesh);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(lines, 3));
  group.add(new THREE.LineSegments(lineGeo, xray(new THREE.LineBasicMaterial({ color: 0x2e2b27, transparent: true, opacity: 0.4 }))));
  return group;
}

function addTo(parent: THREE.Object3D, ...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  children.forEach((c) => g.add(c));
  parent.add(g);
  return g;
}

function objectModel(o: MapObjectDTO, p: IsoPalette, h: WorldHandles): THREE.Object3D | null {
  const cx = o.x + o.w / 2;
  const cz = o.y + o.h / 2;
  const g = new THREE.Group();
  g.position.set(cx, 0, cz);
  switch (o.kind) {
    case "house": {
      const v = Number(o.props.variant ?? 0);
      const roof = [p.roof, p.brickDark, "#7d8466"][v % 3]!;
      g.add(block(o.w - 0.1, 1.9, o.h - 0.1, p.brick));
      g.add(block(o.w + 0.1, 0.2, o.h + 0.1, roof, 0, 1.9));
      g.add(block(0.5, 1.05, 0.06, "#5b4a40", 0, 0, o.h / 2 - 0.02)); // door
      g.add(block(0.36, 0.3, 0.06, "#d7d0bf", -o.w / 2 + 0.55, 0.95, o.h / 2 - 0.02, true)); // window
      break;
    }
    case "watchtower": {
      const ruined = new THREE.Group();
      ruined.add(block(o.w, 0.5, o.h, p.stone));
      ruined.add(block(0.5, 0.35, 0.4, p.stone, -0.5, 0.5, 0.3));
      ruined.add(block(0.35, 0.6, 0.35, p.wood, 0.5, 0.5, -0.4));
      const repaired = new THREE.Group();
      repaired.add(block(o.w, 0.6, o.h, p.stone));
      repaired.add(block(o.w * 0.75, 2.6, o.h * 0.75, p.stone, 0, 0.6));
      repaired.add(block(o.w + 0.2, 0.15, o.h + 0.2, p.wood, 0, 3.2));
      repaired.add(block(o.w * 0.5, 0.6, o.h * 0.5, p.roof, 0, 3.35));
      repaired.visible = false;
      g.add(ruined, repaired);
      h.tower = { ruined, repaired, top: 4.2 };
      break;
    }
    case "well": {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.45, 8), xray(mat(p.stone).clone()));
      ring.position.y = 0.22;
      ring.castShadow = true;
      g.add(ring);
      g.add(block(0.06, 0.9, 0.06, p.wood, -0.4, 0));
      g.add(block(0.06, 0.9, 0.06, p.wood, 0.4, 0));
      g.add(block(1.0, 0.12, 0.5, p.roof, 0, 0.9));
      break;
    }
    case "bell": {
      g.add(block(0.08, 1.2, 0.08, p.wood, -o.w / 2 + 0.2, 0));
      g.add(block(0.08, 1.2, 0.08, p.wood, o.w / 2 - 0.2, 0));
      g.add(block(o.w - 0.2, 0.1, 0.12, p.wood, 0, 1.2));
      const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.25, 0.4, 6), mat(p.gold));
      bell.position.y = 0.95;
      bell.castShadow = true;
      g.add(bell);
      break;
    }
    case "shrine": {
      g.add(block(o.w, 0.15, o.h, p.ruin));
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        g.add(block(0.18, 1.0, 0.18, p.ruin, (x * o.w) / 2.6, 0.15, (z * o.h) / 2.6));
      }
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.22),
        new THREE.MeshLambertMaterial({ color: p.crystal, emissive: p.crystal, emissiveIntensity: 0.5, flatShading: true }),
      );
      gem.position.y = 0.9;
      gem.name = "spin";
      g.add(gem);
      break;
    }
    case "mine_entrance": {
      g.add(block(o.w, 1.0, 0.4, p.rock, 0, 0, -0.2));
      g.add(block(o.w * 0.5, 0.75, 0.05, "#3a3630", 0, 0, 0.02, false));
      g.add(block(0.1, 0.8, 0.1, p.wood, -o.w / 4 - 0.05, 0, 0.05));
      g.add(block(0.1, 0.8, 0.1, p.wood, o.w / 4 + 0.05, 0, 0.05));
      g.add(block(o.w * 0.6, 0.1, 0.12, p.wood, 0, 0.8, 0.05));
      break;
    }
    case "beacon": {
      g.add(block(0.5, 0.6, 0.5, p.stone));
      g.add(block(0.62, 0.12, 0.62, p.wood, 0, 0.6));
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.2, 0.5, 5),
        new THREE.MeshLambertMaterial({ color: p.fire, emissive: p.fire, emissiveIntensity: 0.9, flatShading: true }),
      );
      flame.position.y = 0.97;
      const lit = addTo(g, flame);
      lit.visible = false;
      h.beacons.set(o.id, { lit, flame });
      break;
    }
    case "resource_node": {
      const wood = o.props.resource === "wood";
      const full = new THREE.Group();
      const empty = new THREE.Group();
      if (wood) {
        // A small pile of logs, and a stump once it's used up.
        for (let i = 0; i < 3; i++) {
          const log = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.7, 6), mat(p.wood));
          log.rotation.z = Math.PI / 2;
          log.position.set(0, 0.11 + (i === 2 ? 0.19 : 0), i === 2 ? 0 : (i - 0.5) * 0.24);
          log.castShadow = true;
          full.add(log);
        }
        empty.add(block(0.3, 0.15, 0.3, p.wood));
      } else {
        full.add(block(0.5, 0.35, 0.45, p.stone, -0.08, 0, 0));
        full.add(block(0.3, 0.25, 0.3, p.rock, 0.22, 0, 0.15));
        full.add(block(0.25, 0.2, 0.25, p.stone, 0.05, 0.35, -0.05));
        empty.add(block(0.3, 0.12, 0.25, p.rock));
      }
      empty.visible = false;
      g.add(full, empty);
      h.nodes.set(o.id, { full, empty });
      break;
    }
    default:
      return null;
  }
  return g;
}

export function buildWorld(map: MapDTO): WorldHandles {
  const p = isoPalette(map.theme);
  const root = new THREE.Group();
  const handles: WorldHandles = {
    root,
    nodes: new Map(),
    beacons: new Map(),
    tower: null,
    objects: new Map(map.objects.map((o) => [o.id, o])),
    dispose: () => {
      root.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
        }
      });
    },
  };

  // Paper beyond the island, then the painted ground.
  const paper = paperTexture(p);
  paper.repeat.set(40, 40);
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(map.width + 400, map.height + 400), new THREE.MeshBasicMaterial({ map: paper }));
  outside.rotation.x = -Math.PI / 2;
  outside.position.set(map.width / 2, -0.02, map.height / 2);
  root.add(outside);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(map.width, map.height),
    new THREE.MeshLambertMaterial({ map: groundTexture(map, p) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(map.width / 2, 0, map.height / 2);
  ground.receiveShadow = true;
  root.add(ground);

  const walls: Parameters<typeof instancedBoxes>[0] = [];
  const rocks: Parameters<typeof instancedBoxes>[0] = [];
  const trunks: Parameters<typeof instancedBoxes>[0] = [];
  const canopies: Parameters<typeof instancedBoxes>[0] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.tiles[y * map.width + x]!;
      const cx = x + 0.5;
      const cz = y + 0.5;
      const r = hash(x, y, 3);
      if (t === TILE.WALL) {
        walls.push({ x: cx, z: cz, w: 1, h: 1.9, d: 1, color: r > 0.5 ? p.wall : p.wallTop });
      } else if (t === TILE.ROCK) {
        rocks.push({ x: cx, z: cz, w: 0.9 + r * 0.1, h: 0.45 + r * 0.5, d: 0.9, color: p.rock, rot: (r - 0.5) * 0.3 });
      } else if (t === TILE.RUIN) {
        walls.push({ x: cx, z: cz, w: 0.85, h: 0.5 + r * 0.6, d: 0.85, color: p.ruin });
      } else if (t === TILE.TREE) {
        const s = 0.75 + r * 0.25;
        const rot = r * Math.PI;
        trunks.push({ x: cx, z: cz, w: 0.2, h: 0.7, d: 0.2, color: p.trunk });
        canopies.push({ x: cx, z: cz, w: s, h: 0.8 + r * 0.4, d: s, y: 0.65, color: p.canopy[Math.floor(r * 4)]!, rot });
        canopies.push({ x: cx, z: cz, w: s * 0.6, h: 0.45, d: s * 0.6, y: 1.4 + r * 0.35, color: p.canopy[Math.floor(hash(x, y, 7) * 4)]!, rot: rot + 0.4 });
      }
    }
  }
  root.add(instancedBoxes(walls), instancedBoxes(rocks), instancedBoxes(trunks), instancedBoxes(canopies));

  for (const o of map.objects) {
    const model = objectModel(o, p, handles);
    if (!model) continue;
    model.traverse((n) => {
      if (n instanceof THREE.Mesh || n instanceof THREE.LineSegments) {
        // Each object gets its own see-through-capable copy of its material.
        const m = (n.material as THREE.Material).clone();
        n.material = xray(m);
      }
    });
    root.add(model);
  }
  return handles;
}

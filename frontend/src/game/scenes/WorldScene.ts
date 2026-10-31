/**
 * The 3D isometric world (Three.js): blocky animated contestants on a drafting-paper island, with
 * HTML name tags, speech bubbles and prompts layered on top.
 *
 * Game logic is unchanged: input goes through the same fixed-step prediction as before, and the
 * server stays authoritative. Movement is screen-relative (W walks "up" the screen), converted to
 * map directions before it is sent.
 */
import * as THREE from "three";
import { ARCHETYPES } from "../archetypes";
import type { GameClient } from "../net/client";
import { buildFigure, type Figure } from "../iso/figure";
import { isoPalette } from "../iso/palette3d";
import { buildWorld, XRAY, type WorldHandles } from "../iso/world";
import { DT } from "@/shared/physics";
import { loadSettings, onSettings } from "@/lib/settings";
import type { BodyDTO, ContestantDTO, Facing, GameEventDTO, MapObjectDTO } from "@/shared/protocol";

const STEP_MS = DT * 1000;
const INTERP_DELAY_MS = 100;
const ELEVATION = THREE.MathUtils.degToRad(35);
const AZIMUTH = Math.PI / 4;
const CAMERA_DIST = 60;
const ZOOM_DEFAULT = 9; // world units visible vertically
const ZOOM_MIN = 6;
const ZOOM_MAX = 20;
const FACING_YAW: Record<Facing, number> = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
const CONE_RADIUS = 2.4;
const CONE_ANGLE = THREE.MathUtils.degToRad(70);
const HEAD_Y = 1.45;

export interface SceneDeps {
  client: GameClient;
  reducedMotion: () => boolean;
}

interface Actor {
  figure: Figure;
  cone: THREE.Group;
  carry: THREE.Group;
  tag: HTMLDivElement;
  bubble: HTMLDivElement | null;
  bubbleUntil: number;
  look: string;
  x: number;
  z: number;
  yaw: number;
  speed: number;
}

function el(cls: string, text = ""): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  d.textContent = text;
  return d;
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Screen-relative input (x right, y down) → map direction for the isometric camera. */
export function screenToMap(sx: number, sy: number): [number, number] {
  const dx = (sx + sy) / Math.SQRT2;
  const dy = (sy - sx) / Math.SQRT2;
  return [Math.max(-1, Math.min(1, dx)), Math.max(-1, Math.min(1, dy))];
}

export class WorldScene {
  /** Movement and actions from touch controls or scripts, in map directions. */
  touch = { dx: 0, dy: 0, interact: false, kill: false };

  private deps: SceneDeps;
  private parent: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private sun = new THREE.DirectionalLight(0xffffff, 1.6);
  private overlay: HTMLDivElement;
  private world: WorldHandles | null = null;
  private actors = new Map<string, Actor>();
  private bodies = new Map<string, Figure>();
  private marker: THREE.Mesh;
  private promptEl: HTMLDivElement;
  private killEl: HTMLDivElement;
  private edgeArrow: HTMLDivElement;
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private zoom = ZOOM_DEFAULT;
  private target = new THREE.Vector3();
  private acc = 0;
  private lastFrame = 0;
  private localMoving = false;
  private localYaw = 0;
  private towerRepaired = false;
  private raf = 0;
  private unsub: (() => void) | null = null;
  private resizeObs: ResizeObserver;
  private cleanups: (() => void)[] = [];
  private lowQuality = false;
  private slowFrames = 0;
  private sampledFrames = 0;

  constructor(parent: HTMLElement, deps: SceneDeps) {
    this.parent = parent;
    this.deps = deps;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.style.display = "block";
    parent.appendChild(this.renderer.domElement);
    this.overlay = el("iso-overlay");
    parent.appendChild(this.overlay);

    this.scene.add(new THREE.HemisphereLight(0xfff8ec, 0xb5ab98, 1.6));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -22;
    sc.right = 22;
    sc.top = 22;
    sc.bottom = -22;
    sc.near = 1;
    sc.far = 80;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.28),
      new THREE.MeshLambertMaterial({ color: 0xc0573e, emissive: 0xc0573e, emissiveIntensity: 0.4, flatShading: true }),
    );
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.promptEl = el("iso-prompt");
    this.killEl = el("iso-prompt iso-prompt-danger");
    this.edgeArrow = el("iso-edge-arrow", "▲");
    for (const e of [this.promptEl, this.killEl, this.edgeArrow]) {
      e.style.display = "none";
      this.overlay.appendChild(e);
    }

    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!e.repeat) this.pressed.add(k);
      this.keys.add(k);
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
    const blur = () => this.keys.clear();
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.zoom = THREE.MathUtils.clamp(this.zoom * (e.deltaY > 0 ? 1.1 : 0.9), ZOOM_MIN, ZOOM_MAX);
      this.resize();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    this.renderer.domElement.addEventListener("wheel", wheel, { passive: false });
    this.cleanups.push(() => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    });

    this.unsub = deps.client.onEvent((ev) => this.onGameEvent(ev));
    this.applyQuality(loadSettings().graphics === "low");
    this.cleanups.push(onSettings((st) => this.applyQuality(st.graphics === "low" || (st.graphics === "auto" && this.lowQuality))));
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(parent);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Low quality: no shadows, 1x resolution. Used on request, or automatically when frames are slow. */
  private applyQuality(low: boolean): void {
    this.lowQuality = low;
    this.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !low;
    this.sun.castShadow = !low;
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.resize();
  }

  /** Auto quality: after a few seconds of play, drop to low if most frames took longer than ~40 ms. */
  private watchFrameRate(delta: number): void {
    if (this.lowQuality || loadSettings().graphics !== "auto" || this.sampledFrames > 240) return;
    this.sampledFrames++;
    if (delta > 40) this.slowFrames++;
    if (this.sampledFrames >= 60 && this.slowFrames / this.sampledFrames > 0.5) this.applyQuality(true);
  }

  /** Touch arrows are screen-relative; store them as a map direction. */
  setTouchFromScreen(sx: number, sy: number): void {
    const [dx, dy] = sx === 0 && sy === 0 ? [0, 0] : screenToMap(sx, sy);
    this.touch = { ...this.touch, dx, dy };
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.unsub?.();
    this.resizeObs.disconnect();
    this.cleanups.forEach((c) => c());
    this.world?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.remove();
  }

  private resize(): void {
    const w = Math.max(1, this.parent.clientWidth);
    const h = Math.max(1, this.parent.clientHeight);
    this.renderer.setSize(w, h);
    // Small screens show a little more of the island.
    const viewH = this.zoom * (w < 640 ? 1.15 : 1);
    const aspect = w / h;
    this.camera.left = (-viewH * aspect) / 2;
    this.camera.right = (viewH * aspect) / 2;
    this.camera.top = viewH / 2;
    this.camera.bottom = -viewH / 2;
    this.camera.updateProjectionMatrix();
  }

  private build(): void {
    const map = this.deps.client.map!;
    const p = isoPalette(map.theme);
    this.scene.background = new THREE.Color(p.paper);
    this.world = buildWorld(map);
    this.scene.add(this.world.root);
  }

  private readInput(): [number, number] {
    if (this.deps.client.store.get().typing) return [0, 0];
    const k = this.keys;
    let sx = 0;
    let sy = 0;
    if (k.has("arrowleft") || k.has("a")) sx -= 1;
    if (k.has("arrowright") || k.has("d")) sx += 1;
    if (k.has("arrowup") || k.has("w")) sy -= 1;
    if (k.has("arrowdown") || k.has("s")) sy += 1;
    if (sx !== 0 || sy !== 0) return screenToMap(sx, sy);
    return [this.touch.dx, this.touch.dy];
  }

  private justPressed(...keys: string[]): boolean {
    const typing = this.deps.client.store.get().typing;
    return !typing && keys.some((k) => this.pressed.has(k));
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const client = this.deps.client;
    if (!client.map || !client.snapshot) return;
    if (!this.world) this.build();
    const snap = client.snapshot;
    const delta = this.lastFrame === 0 ? 0 : Math.min(250, now - this.lastFrame);
    this.lastFrame = now;
    const dt = delta / 1000;
    const reduced = this.deps.reducedMotion();
    if (delta > 0) this.watchFrameRate(delta);

    // Fixed-step input + prediction (unchanged from the 2D client).
    this.acc = Math.min(this.acc + delta, STEP_MS * 5);
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      const [dx, dy] = this.readInput();
      client.applyInput(dx, dy);
      this.localMoving = dx !== 0 || dy !== 0;
      if (this.localMoving) this.localYaw = Math.atan2(dx, dy);
    }
    const alpha = this.acc / STEP_MS;
    const decay = Math.pow(0.001, dt / 0.25);
    client.correction.x *= decay;
    client.correction.y *= decay;

    const present = new Set(snap.contestants.map((c) => c.id));
    for (const [id, a] of this.actors) {
      if (!present.has(id)) this.setVisible(a, false);
    }
    const t = performance.now();
    for (const c of snap.contestants) {
      const a = this.ensureActor(c);
      this.setVisible(a, true);
      let x: number;
      let z: number;
      let moving: boolean;
      if (c.id === client.you && client.predictor) {
        const p = client.predictor;
        x = client.prev.x + (p.x - client.prev.x) * alpha + client.correction.x;
        z = client.prev.y + (p.y - client.prev.y) * alpha + client.correction.y;
        moving = this.localMoving && client.canMove && Math.abs(p.x - client.prev.x) + Math.abs(p.y - client.prev.y) > 1e-6;
        if (moving) a.yaw += shortestAngle(a.yaw, this.localYaw) * Math.min(1, dt * 14);
      } else {
        const s = client.buffers.get(c.id)?.sample(t - INTERP_DELAY_MS);
        x = s?.x ?? c.x;
        z = s?.y ?? c.y;
        const mx = x - a.x;
        const mz = z - a.z;
        moving = c.moving || Math.hypot(mx, mz) > 1e-3;
        if (Math.hypot(mx, mz) > 1e-3) a.yaw += shortestAngle(a.yaw, Math.atan2(mx, mz)) * Math.min(1, dt * 12);
        else if (!c.moving && a.speed < 0.05) a.yaw += shortestAngle(a.yaw, FACING_YAW[c.facing]) * Math.min(1, dt * 4);
      }
      a.x = x;
      a.z = z;
      a.speed += ((moving ? 1 : 0) - a.speed) * Math.min(1, dt * 10);
      this.placeActor(a, c, dt, reduced);
    }

    this.updateWorldState(snap.nodes, snap.mission.status === "completed", snap.beacons, now, reduced);
    this.updateBodies(snap.bodies ?? []);
    this.updateCamera(dt);
    this.updatePrompts(now, reduced);
    this.pressed.clear();
    this.renderer.render(this.scene, this.camera);
    this.updateOverlay(now);
  };

  private ensureActor(c: ContestantDTO): Actor {
    const look = `${c.archetype}~${c.cosmetics?.skin?.id ?? ""}~${c.cosmetics?.hat?.id ?? ""}`;
    let a = this.actors.get(c.id);
    if (a && a.look === look) return a;
    if (a) {
      a.figure.dispose();
      a.cone.removeFromParent();
      a.carry.removeFromParent();
      a.tag.remove();
      a.bubble?.remove();
    }
    const figure = buildFigure(c.archetype, c.cosmetics);
    this.scene.add(figure.root);
    const isMe = c.id === this.deps.client.you;
    const cone = this.makeCone(isMe);
    this.scene.add(cone);
    const carry = new THREE.Group();
    this.scene.add(carry);
    const tag = el(`iso-tag${isMe ? " iso-tag-me" : ""}`, c.name.toUpperCase());
    this.overlay.appendChild(tag);
    a = { figure, cone, carry, tag, bubble: null, bubbleUntil: 0, look, x: c.x, z: c.y, yaw: FACING_YAW[c.facing], speed: 0 };
    this.actors.set(c.id, a);
    if (isMe) this.target.set(c.x, 0, c.y);
    return a;
  }

  private makeCone(mine: boolean): THREE.Group {
    const g = new THREE.Group();
    const color = mine ? 0xc0573e : 0x6f6a60;
    const fan = new THREE.Mesh(
      new THREE.CircleGeometry(CONE_RADIUS, 18, Math.PI / 2 - CONE_ANGLE / 2, CONE_ANGLE),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: mine ? 0.1 : 0.07, depthWrite: false }),
    );
    fan.rotation.x = -Math.PI / 2;
    g.add(fan);
    const pts = [new THREE.Vector3(0, 0, 0)];
    for (let i = 0; i <= 18; i++) {
      const a = Math.PI / 2 - CONE_ANGLE / 2 + (CONE_ANGLE * i) / 18;
      pts.push(new THREE.Vector3(Math.cos(a) * CONE_RADIUS, Math.sin(a) * CONE_RADIUS, 0));
    }
    pts.push(new THREE.Vector3(0, 0, 0));
    const outline = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color, dashSize: 0.18, gapSize: 0.12, transparent: true, opacity: 0.45 }),
    );
    outline.computeLineDistances();
    outline.rotation.x = -Math.PI / 2;
    g.add(outline);
    g.position.y = 0.02;
    return g;
  }

  private placeActor(a: Actor, c: ContestantDTO, dt: number, reduced: boolean): void {
    const client = this.deps.client;
    const isMe = c.id === client.you;
    const f = a.figure;
    f.root.position.set(a.x, 0, a.z);
    f.root.rotation.y = a.yaw;
    f.setGhost(!c.alive);
    const aim = isMe && !!client.store.get().killTarget;
    f.animate(dt, a.speed, { aim, reduced });
    a.cone.position.set(a.x, 0.02, a.z);
    a.cone.rotation.y = a.yaw;
    a.cone.visible = c.alive;
    // Carried wood/stone as little blocks over the shoulder.
    const units: string[] = [];
    for (const [res, n] of Object.entries(c.carrying)) for (let i = 0; i < n; i++) units.push(res);
    const key = units.join(",");
    if (a.carry.userData.key !== key) {
      a.carry.clear();
      units.forEach((res, i) => {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, 0.16, 0.16),
          new THREE.MeshLambertMaterial({ color: res === "wood" ? 0x8c6a52 : 0xb3ada0, flatShading: true }),
        );
        m.position.set((i - (units.length - 1) / 2) * 0.2, 0, 0);
        a.carry.add(m);
      });
      a.carry.userData.key = key;
    }
    a.carry.position.set(a.x, HEAD_Y + 0.2 + (reduced ? 0 : Math.sin(performance.now() / 300) * 0.03), a.z);
    a.carry.rotation.y = a.yaw;
    const fellow = client.snapshot?.me?.fellow_impostors?.includes(c.id);
    a.tag.textContent = `${c.alive ? "" : "👻 "}${c.name.toUpperCase()}`;
    a.tag.classList.toggle("iso-tag-ally", !!fellow);
    a.tag.style.opacity = c.connected ? "1" : "0.5";
  }

  private setVisible(a: Actor, visible: boolean): void {
    if (a.figure.root.visible === visible) return;
    a.figure.root.visible = visible;
    a.cone.visible = visible;
    a.carry.visible = visible;
    a.tag.style.display = visible ? "" : "none";
    if (a.bubble) a.bubble.style.display = visible ? "" : "none";
  }

  private updateWorldState(
    nodes: Record<string, number>, repaired: boolean, beacons: Record<string, boolean> | undefined, now: number, reduced: boolean,
  ): void {
    const w = this.world!;
    for (const [id, n] of w.nodes) {
      const full = (nodes[id] ?? 0) > 0;
      n.full.visible = full;
      n.empty.visible = !full;
    }
    if (w.tower && repaired !== this.towerRepaired) {
      this.towerRepaired = repaired;
      w.tower.ruined.visible = !repaired;
      w.tower.repaired.visible = repaired;
    }
    for (const [id, b] of w.beacons) {
      b.lit.visible = !!beacons?.[id];
      if (b.lit.visible && !reduced) b.flame.scale.y = 1 + Math.sin(now / 90 + id.length) * 0.15;
    }
    w.root.traverse((o) => {
      if (o.name === "spin" && !reduced) o.rotation.y = now / 800;
    });
  }

  private updateBodies(bodies: BodyDTO[]): void {
    const client = this.deps.client;
    const present = new Set(bodies.map((b) => b.id));
    for (const [id, f] of this.bodies) {
      if (!present.has(id)) {
        f.dispose();
        this.bodies.delete(id);
      }
    }
    for (const b of bodies) {
      if (this.bodies.has(b.id)) continue;
      const victim = client.snapshot?.roster.find((r) => r.id === b.victim);
      const f = buildFigure(victim?.archetype ?? "knight", victim?.cosmetics);
      f.setDead(true);
      f.root.position.set(b.x, 0, b.y);
      f.root.rotation.y = (b.x * 13 + b.y * 7) % (Math.PI * 2);
      const stain = new THREE.Mesh(
        new THREE.CircleGeometry(0.55, 10),
        new THREE.MeshBasicMaterial({ color: 0x9a3a2e, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      stain.rotation.x = -Math.PI / 2;
      stain.position.set(0, 0.015, -0.4);
      f.root.add(stain);
      this.scene.add(f.root);
      this.bodies.set(b.id, f);
    }
  }

  private updateCamera(dt: number): void {
    const p = this.deps.client.predictor;
    const me = this.actors.get(this.deps.client.you ?? "");
    if (p && me) {
      const k = 1 - Math.pow(0.0005, dt);
      this.target.x += (me.x - this.target.x) * k;
      this.target.z += (me.z - this.target.z) * k;
    }
    const off = new THREE.Vector3(
      Math.cos(ELEVATION) * Math.sin(AZIMUTH),
      Math.sin(ELEVATION),
      Math.cos(ELEVATION) * Math.cos(AZIMUTH),
    ).multiplyScalar(CAMERA_DIST);
    this.camera.position.copy(this.target).add(off);
    this.camera.lookAt(this.target);
    this.sun.position.set(this.target.x - 10, 25, this.target.z + 6);
    this.sun.target.position.copy(this.target);

    // See-through hole: anything drawn in front of the player near them on screen dithers away.
    if (me) {
      const v = new THREE.Vector3(me.x, 0.7, me.z).project(this.camera);
      const pr = this.renderer.getPixelRatio();
      const w = this.parent.clientWidth;
      const h = this.parent.clientHeight;
      XRAY.uXrayPos.value.set(((v.x + 1) / 2) * w * pr, ((v.y + 1) / 2) * h * pr);
      XRAY.uXrayDepth.value = v.z * 0.5 + 0.5 - 0.002;
      XRAY.uXrayR.value = (h / this.zoom) * 1.6 * pr;
    }
  }

  /** World point → CSS pixels in the overlay. */
  private toScreen(x: number, y: number, z: number): { x: number; y: number; on: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const w = this.parent.clientWidth;
    const h = this.parent.clientHeight;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, on: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 };
  }

  private updateOverlay(now: number): void {
    for (const a of this.actors.values()) {
      if (!a.figure.root.visible) continue;
      const s = this.toScreen(a.x, HEAD_Y + 0.1, a.z);
      a.tag.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      if (a.bubble) {
        if (now > a.bubbleUntil) {
          a.bubble.remove();
          a.bubble = null;
        } else {
          a.bubble.style.transform = `translate(${s.x}px, ${s.y - 26}px) translate(-50%, -100%)`;
        }
      }
    }
  }

  private showBubble(id: string, text: string, whisper: boolean): void {
    const a = this.actors.get(id);
    if (!a) return;
    a.bubble?.remove();
    const b = el(`iso-bubble${whisper ? " iso-bubble-whisper" : ""}`);
    const who = el("iso-bubble-name", (this.deps.client.name(id) || "").toUpperCase());
    const line = el("iso-bubble-text", text.length > 80 ? `${text.slice(0, 78)}…` : text);
    b.append(who, line);
    if (!a.figure.root.visible) b.style.display = "none";
    this.overlay.appendChild(b);
    a.bubble = b;
    a.bubbleUntil = performance.now() + 4500;
  }

  private updatePrompts(now: number, reduced: boolean): void {
    const client = this.deps.client;
    const map = client.map!;
    const p = client.predictor;
    const range = client.constants?.interact_range ?? 1.3;
    const store = client.store;

    // Nearest interactable in range; bodies win.
    let best: { o: MapObjectDTO; d: number } | null = null;
    if (p && client.canAct) {
      const reportRange = client.constants?.report_range ?? 2;
      for (const b of client.snapshot?.bodies ?? []) {
        const d = Math.hypot(p.x - b.x, p.y - b.y) - 10;
        if (d + 10 <= reportRange && (!best || d < best.d)) {
          best = {
            o: { id: b.id, kind: "body", x: b.x - 0.5, y: b.y - 0.5, w: 1, h: 1, solid: false, interactable: true, props: { victim: b.victim } },
            d,
          };
        }
      }
      for (const o of map.objects) {
        if (!o.interactable) continue;
        const cx = Math.min(Math.max(p.x, o.x), o.x + o.w);
        const cy = Math.min(Math.max(p.y, o.y), o.y + o.h);
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d <= range && (!best || d < best.d)) best = { o, d };
      }
    }
    this.updateKillTarget();
    if (best) {
      const label = this.promptLabel(best.o);
      this.promptEl.textContent = "";
      this.promptEl.append(el("iso-key", "E"), document.createTextNode(label));
      const top = best.o.kind === "watchtower" ? (this.towerRepaired ? 4.4 : 1.4) : 1.5;
      const s = this.toScreen(best.o.x + best.o.w / 2, top, best.o.y + best.o.h / 2);
      this.promptEl.style.display = "";
      this.promptEl.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      const cur = store.get().prompt;
      if (cur?.targetId !== best.o.id || cur.label !== label) store.set({ prompt: { targetId: best.o.id, label } });
      if (this.justPressed("e", " ") || this.touch.interact) client.interact(best.o.id);
      this.touch.interact = false;
    } else {
      this.promptEl.style.display = "none";
      if (store.get().prompt) store.set({ prompt: null });
      this.touch.interact = false;
    }

    // Mission marker over the watchtower, and an edge arrow when it is off-screen.
    const mission = client.snapshot!.mission;
    const target = map.objects.find((o) => o.id === mission.target_id);
    const active = mission.status === "active" && client.canAct;
    this.marker.visible = !!target && active;
    this.edgeArrow.style.display = "none";
    if (!target || !active) return;
    const tx = target.x + target.w / 2;
    const tz = target.y + target.h / 2;
    const ty = (this.towerRepaired ? 4.6 : 1.9) + (reduced ? 0 : Math.sin(now / 250) * 0.12);
    this.marker.position.set(tx, ty, tz);
    this.marker.rotation.y = reduced ? 0 : now / 600;
    const s = this.toScreen(tx, ty, tz);
    if (!s.on) {
      const w = this.parent.clientWidth;
      const h = this.parent.clientHeight;
      const ang = Math.atan2(s.y - h / 2, s.x - w / 2);
      const m = 28;
      const k = Math.min((w / 2 - m) / Math.abs(Math.cos(ang) || 1e-6), (h / 2 - m) / Math.abs(Math.sin(ang) || 1e-6));
      this.edgeArrow.style.display = "";
      this.edgeArrow.style.transform =
        `translate(${w / 2 + Math.cos(ang) * k}px, ${h / 2 + Math.sin(ang) * k}px) translate(-50%, -50%) rotate(${ang + Math.PI / 2}rad)`;
    }
  }

  /** Impostors: closest islander in kill range when the knife is ready. Sheriff: closest contestant in range. */
  private updateKillTarget(): void {
    const client = this.deps.client;
    const snap = client.snapshot;
    const store = client.store;
    const p = client.predictor;
    const me = snap?.me;
    const impostor = me?.role === "impostor" && (me.kill_cooldown ?? 1) <= 0;
    const sheriff = me?.role === "sheriff" && me.bullet_used === false;
    let target: ContestantDTO | null = null;
    if (p && snap && me && client.canAct && (impostor || sheriff)) {
      const range = impostor ? (client.constants?.kill_range ?? 1.5) : (client.constants?.shoot_range ?? 2);
      const fellow = new Set(me.fellow_impostors ?? []);
      const server = snap.contestants.find((c) => c.id === client.you) ?? p;
      let bestD = Infinity;
      for (const c of snap.contestants) {
        if (c.id === client.you || !c.alive || fellow.has(c.id)) continue;
        const d = Math.max(Math.hypot(c.x - p.x, c.y - p.y), Math.hypot(c.x - server.x, c.y - server.y));
        if (d <= range - 0.1 && d < bestD) {
          bestD = d;
          target = c;
        }
      }
    }
    const pressed = this.justPressed("k") || this.touch.kill;
    this.touch.kill = false;
    const cur = store.get().killTarget;
    if ((cur?.id ?? null) !== (target?.id ?? null)) {
      store.set({ killTarget: target ? { id: target.id, name: target.name } : null });
    }
    if (target) {
      const a = this.actors.get(target.id);
      this.killEl.textContent = "";
      this.killEl.append(el("iso-key", "K"), document.createTextNode(`${sheriff ? "Shoot" : "Eliminate"} ${target.name}`));
      const s = this.toScreen(a?.x ?? target.x, HEAD_Y + 0.75, a?.z ?? target.y);
      this.killEl.style.display = "";
      this.killEl.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      if (pressed) {
        if (sheriff) client.shoot(target.id);
        else client.kill(target.id);
      }
    } else {
      this.killEl.style.display = "none";
    }
  }

  private promptLabel(o: MapObjectDTO): string {
    const client = this.deps.client;
    if (o.kind === "resource_node") {
      const left = client.snapshot?.nodes[o.id] ?? 0;
      return left > 0 ? `Gather ${String(o.props.resource)} (${left})` : "Depleted";
    }
    if (o.kind === "watchtower") return client.snapshot?.mission.status === "completed" ? "Repaired" : "Deliver materials";
    if (o.kind === "shrine") {
      const s = client.snapshot?.shrine;
      if (!s || s.status === "activated") return "The shrine is awake";
      return s.status === "channeling" ? `Join the ritual (${s.count}/${s.required})` : `Channel (needs ${s.required})`;
    }
    if (o.kind === "bell") return client.snapshot?.me?.bell_used ? "Bell already rung" : "Ring the Council Bell";
    if (o.kind === "body") return `Report ${client.name(String(o.props.victim))}'s body!`;
    if (o.kind === "beacon") {
      if (client.snapshot?.beacons?.[o.id]) return "Beacon burning";
      return client.snapshot?.me?.role === "impostor" ? "Pretend to light the beacon" : "Light the beacon (1 wood)";
    }
    return String(o.props.label ?? o.kind);
  }

  private onGameEvent(ev: GameEventDTO): void {
    const client = this.deps.client;
    if (!this.world) return;
    if (ev.type === "chat") {
      const s = loadSettings();
      if (client.isMuted(String(ev.data.sender)) || !s.bubbles || (s.hideChat && ev.data.sender !== client.you)) return;
      this.showBubble(String(ev.data.sender), String(ev.data.text), !!ev.data.private);
      return;
    }
    if (ev.type === "resource_gathered" || ev.type === "resources_delivered") {
      const actor = this.actors.get(String(ev.data.contestant));
      if (!actor) return;
      const isMe = ev.data.contestant === client.you;
      if (!isMe && ev.type === "resource_gathered") return;
      const effect = client.contestant(String(ev.data.contestant))?.cosmetics?.effect;
      const base = ev.type === "resource_gathered" ? `+1 ${String(ev.data.resource)}` : `+${String(ev.data.points)}`;
      const text = effect && ev.type === "resources_delivered" ? `${effect.glyph} ${base} ${effect.glyph}` : base;
      this.floatText(actor.x, HEAD_Y + 0.5, actor.z, text, isMe);
    }
    if (ev.type === "mission_completed" && this.world.tower) {
      const t = [...this.world.objects.values()].find((o) => o.kind === "watchtower");
      if (t) this.floatText(t.x + t.w / 2, 4.6, t.y + t.h / 2, "Repaired!", true);
    }
  }

  private floatText(x: number, y: number, z: number, text: string, mine: boolean): void {
    const s = this.toScreen(x, y, z);
    const f = el(`iso-float${mine ? " iso-float-me" : ""}`, text);
    f.style.left = `${s.x}px`;
    f.style.top = `${s.y}px`;
    if (this.deps.reducedMotion()) f.style.animation = "none";
    this.overlay.appendChild(f);
    setTimeout(() => f.remove(), 900);
  }
}

export const ARCHETYPE_KEYS = Object.keys(ARCHETYPES);

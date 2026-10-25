import * as Phaser from "phaser";
import { ARCHETYPES, FRAME, FRAME_H, buildCharacterSheet } from "../art/characters";
import * as Obj from "../art/objects";
import { TILE, renderTiles } from "../art/tiles";
import type { GameClient } from "../net/client";
import { DT } from "@/shared/physics";
import type { ContestantDTO, Facing, GameEventDTO, MapObjectDTO } from "@/shared/protocol";

const STEP_MS = DT * 1000;
const INTERP_DELAY_MS = 100;
const DIR_INDEX: Record<Facing, number> = { down: 0, up: 1, left: 2, right: 2 };

interface ActorView {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  carry: Phaser.GameObjects.Image[];
  archetype: string;
  lastX: number;
  lastY: number;
}

export interface SceneDeps {
  client: GameClient;
  reducedMotion: () => boolean;
}

export class WorldScene extends Phaser.Scene {
  private deps!: SceneDeps;
  private actors = new Map<string, ActorView>();
  private nodeSprites = new Map<string, Phaser.GameObjects.Image>();
  private tower: Phaser.GameObjects.Image | null = null;
  private towerRepaired = false;
  private marker!: Phaser.GameObjects.Image;
  private edgeArrow!: Phaser.GameObjects.Image;
  private promptBubble!: Phaser.GameObjects.Text;
  private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d" | "e" | "space", Phaser.Input.Keyboard.Key>;
  private acc = 0;
  private lastFrame = 0;
  private localFacing: Facing = "down";
  private localMoving = false;
  private built = false;
  private unsub: (() => void) | null = null;
  /** Touch joystick vector, set by the React overlay. */
  touch = { dx: 0, dy: 0, interact: false };

  constructor() {
    super("world");
  }

  init(deps: SceneDeps): void {
    this.deps = deps;
  }

  create(): void {
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = kb.addKeys({
      up: K.UP, down: K.DOWN, left: K.LEFT, right: K.RIGHT,
      w: K.W, a: K.A, s: K.S, d: K.D, e: K.E, space: K.SPACE,
    }, false) as typeof this.keys;
    this.cameras.main.setBackgroundColor("#2f68b8");
    this.unsub = this.deps.client.onEvent((ev) => this.onGameEvent(ev));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsub?.());
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.fitCamera());
  }

  private texture(key: string, make: () => HTMLCanvasElement): string {
    if (!this.textures.exists(key)) this.textures.addCanvas(key, make());
    return key;
  }

  private buildWorld(): void {
    const client = this.deps.client;
    const map = client.map!;
    this.add.image(0, 0, this.texture("tiles", () => renderTiles(map))).setOrigin(0, 0).setDepth(-100000);

    for (const o of map.objects) this.addObject(o);

    this.marker = this.add.image(0, 0, this.texture("arrow", Obj.arrow)).setOrigin(0.5, 1).setDepth(900000);
    this.edgeArrow = this.add.image(0, 0, "arrow").setDepth(950000).setScrollFactor(0).setVisible(false);
    this.promptBubble = this.add
      .text(0, 0, "", { fontFamily: "Pixelify Sans, monospace", fontSize: "8px", color: "#fbf7ee",
        backgroundColor: "#1f1630", padding: { x: 3, y: 1 } })
      .setResolution(4).setOrigin(0.5, 1).setDepth(960000).setVisible(false);

    this.cameras.main.setBounds(0, 0, map.width * TILE, map.height * TILE);
    this.fitCamera();
    this.built = true;
  }

  private fitCamera(): void {
    const cam = this.cameras.main;
    const w = this.scale.width;
    // Show roughly 26 tiles across on desktop, never smaller than 2x pixels.
    cam.setZoom(Math.max(2, Math.round(w / (26 * TILE))));
  }

  private addObject(o: MapObjectDTO): void {
    const cx = (o.x + o.w / 2) * TILE;
    const bottom = (o.y + o.h) * TILE;
    let key: string | null = null;
    switch (o.kind) {
      case "house": {
        const v = Number(o.props.variant ?? 0);
        key = this.texture(`house-${v}`, () => Obj.house(v));
        break;
      }
      case "watchtower":
        this.texture("tower-ruined", () => Obj.watchtower(false));
        this.texture("tower-repaired", () => Obj.watchtower(true));
        this.tower = this.add.image(cx, bottom, "tower-ruined").setOrigin(0.5, 1).setDepth(bottom);
        return;
      case "well":
        key = this.texture("well", Obj.well);
        break;
      case "shrine":
        key = this.texture("shrine", Obj.shrine);
        break;
      case "mine_entrance":
        key = this.texture("mine", Obj.mineEntrance);
        break;
      case "bell":
        key = this.texture("bell", Obj.bell);
        break;
      case "resource_node": {
        const res = String(o.props.resource);
        this.texture(`${res}-full`, () => (res === "wood" ? Obj.woodNode(false) : Obj.stoneNode(false)));
        this.texture(`${res}-empty`, () => (res === "wood" ? Obj.woodNode(true) : Obj.stoneNode(true)));
        const img = this.add.image(cx, bottom, `${res}-full`).setOrigin(0.5, 1).setDepth(bottom);
        this.nodeSprites.set(o.id, img);
        return;
      }
    }
    if (key) this.add.image(cx, bottom, key).setOrigin(0.5, 1).setDepth(bottom);
  }

  private ensureActor(c: ContestantDTO): ActorView {
    let a = this.actors.get(c.id);
    if (a) return a;
    const sheetKey = `char-${c.archetype}`;
    if (!this.textures.exists(sheetKey)) {
      const tex = this.textures.addCanvas(sheetKey, buildCharacterSheet(c.archetype))!;
      for (let i = 0; i < 9; i++) tex.add(i, 0, i * FRAME, 0, FRAME, FRAME_H);
      for (let d = 0; d < 3; d++) {
        this.anims.create({
          key: `${c.archetype}-walk-${d}`,
          frames: [1, 0, 2, 0].map((f) => ({ key: sheetKey, frame: d * 3 + f })),
          frameRate: 10,
          repeat: -1,
        });
      }
    }
    const shadow = this.add.image(0, 0, this.texture("shadow", Obj.shadow)).setOrigin(0.5, 0.5);
    const sprite = this.add.sprite(0, 0, sheetKey, 0).setOrigin(0.5, 1);
    const isMe = c.id === this.deps.client.you;
    const label = this.add
      .text(0, 0, c.name, { fontFamily: "Pixelify Sans, monospace", fontSize: "7px",
        color: isMe ? "#ffe066" : "#fbf7ee", stroke: "#1f1630", strokeThickness: 2 })
      .setResolution(4).setOrigin(0.5, 1);
    this.texture("icon-wood", () => Obj.resourceIcon("wood"));
    this.texture("icon-stone", () => Obj.resourceIcon("stone"));
    const carry = [0, 1, 2].map(() => this.add.image(0, 0, "icon-wood").setOrigin(0.5, 1).setVisible(false));
    a = { sprite, shadow, label, carry, archetype: c.archetype, lastX: c.x, lastY: c.y };
    this.actors.set(c.id, a);
    if (isMe) this.cameras.main.startFollow(sprite, true, 0.2, 0.2, 0, 8);
    return a;
  }

  private readInput(): [number, number] {
    const k = this.keys;
    let dx = 0;
    let dy = 0;
    if (k.left.isDown || k.a.isDown) dx -= 1;
    if (k.right.isDown || k.d.isDown) dx += 1;
    if (k.up.isDown || k.w.isDown) dy -= 1;
    if (k.down.isDown || k.s.isDown) dy += 1;
    if (dx === 0 && dy === 0 && (this.touch.dx !== 0 || this.touch.dy !== 0)) {
      dx = this.touch.dx;
      dy = this.touch.dy;
    }
    return [dx, dy];
  }

  update(): void {
    const client = this.deps.client;
    if (!client.map || !client.snapshot) return;
    if (!this.built) this.buildWorld();
    const snap = client.snapshot;
    const now = performance.now();
    // Use wall-clock time: Phaser smooths its delta toward the target frame time, which would
    // make movement slow down on machines that can't hold 60 fps.
    const delta = this.lastFrame === 0 ? 0 : Math.min(250, now - this.lastFrame);
    this.lastFrame = now;
    const reduced = this.deps.reducedMotion();

    // Fixed-step input + prediction.
    this.acc = Math.min(this.acc + delta, STEP_MS * 5);
    while (this.acc >= STEP_MS) {
      this.acc -= STEP_MS;
      const [dx, dy] = this.readInput();
      client.applyInput(dx, dy);
      this.localMoving = dx !== 0 || dy !== 0;
      if (this.localMoving) {
        this.localFacing = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
      }
    }
    const alpha = this.acc / STEP_MS;
    const decay = Math.pow(0.001, delta / 1000 / 0.25); // correction fades over ~250 ms
    client.correction.x *= decay;
    client.correction.y *= decay;

    for (const c of snap.contestants) {
      const a = this.ensureActor(c);
      let x: number;
      let y: number;
      let facing: Facing = c.facing;
      let moving = c.moving;
      if (c.id === client.you && client.predictor) {
        const p = client.predictor;
        x = client.prev.x + (p.x - client.prev.x) * alpha + client.correction.x;
        y = client.prev.y + (p.y - client.prev.y) * alpha + client.correction.y;
        facing = this.localFacing;
        moving = this.localMoving && client.running && (Math.abs(p.x - client.prev.x) + Math.abs(p.y - client.prev.y) > 1e-6);
      } else {
        const s = client.buffers.get(c.id)?.sample(now - INTERP_DELAY_MS);
        x = s?.x ?? c.x;
        y = s?.y ?? c.y;
      }
      this.placeActor(a, c, x, y, facing, moving, reduced, now);
    }

    this.updateWorldState(snap.nodes, snap.mission.status === "completed");
    this.updatePromptAndMarker(reduced, now);
  }

  private placeActor(a: ActorView, c: ContestantDTO, x: number, y: number, facing: Facing, moving: boolean,
    reduced: boolean, now: number): void {
    const px = Math.round(x * TILE);
    const py = Math.round(y * TILE);
    const d = DIR_INDEX[facing];
    a.sprite.setFlipX(facing === "left");
    if (moving) {
      a.sprite.play(`${a.archetype}-walk-${d}`, true);
    } else {
      a.sprite.stop();
      a.sprite.setFrame(d * 3);
    }
    // Idle: a tiny periodic 1px bob, desynchronised per contestant. Disabled for reduced motion.
    const phase = (c.id.charCodeAt(c.id.length - 1) * 137) % 1000;
    const bob = !moving && !reduced && Math.floor((now + phase) / 600) % 2 === 0 ? -1 : 0;
    a.sprite.setPosition(px, py + 3 + bob).setDepth(py);
    a.shadow.setPosition(px, py + 2).setDepth(py - 1);
    a.label.setPosition(px, py - FRAME_H + 2).setDepth(800000);
    const units: string[] = [];
    for (const [res, n] of Object.entries(c.carrying)) for (let i = 0; i < n; i++) units.push(res);
    a.carry.forEach((img, i) => {
      const res = units[i];
      img.setVisible(!!res);
      if (!res) return;
      img.setTexture(`icon-${res}`)
        .setPosition(px + (i - (units.length - 1) / 2) * 9, py - FRAME_H - 6)
        .setDepth(800001);
    });
    a.sprite.setAlpha(c.connected ? 1 : 0.5);
  }

  private updateWorldState(nodes: Record<string, number>, repaired: boolean): void {
    for (const [id, img] of this.nodeSprites) {
      const res = id.startsWith("wood") ? "wood" : "stone";
      const want = (nodes[id] ?? 0) > 0 ? `${res}-full` : `${res}-empty`;
      if (img.texture.key !== want) img.setTexture(want);
    }
    if (this.tower && repaired !== this.towerRepaired) {
      this.towerRepaired = repaired;
      this.tower.setTexture(repaired ? "tower-repaired" : "tower-ruined");
    }
  }

  private updatePromptAndMarker(reduced: boolean, now: number): void {
    const client = this.deps.client;
    const map = client.map!;
    const p = client.predictor;
    const range = client.constants?.interact_range ?? 1.3;
    const store = client.store;

    // Contextual interaction prompt for the nearest interactable in range.
    let best: { o: MapObjectDTO; d: number } | null = null;
    if (p && client.running) {
      for (const o of map.objects) {
        if (!o.interactable) continue;
        const cx = Math.min(Math.max(p.x, o.x), o.x + o.w);
        const cy = Math.min(Math.max(p.y, o.y), o.y + o.h);
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d <= range && (!best || d < best.d)) best = { o, d };
      }
    }
    if (best) {
      const label = this.promptLabel(best.o);
      this.promptBubble.setText(`E  ${label}`).setVisible(true)
        .setPosition((best.o.x + best.o.w / 2) * TILE, best.o.y * TILE - (best.o.kind === "watchtower" ? 40 : 8));
      const cur = store.get().prompt;
      if (cur?.targetId !== best.o.id || cur.label !== label) store.set({ prompt: { targetId: best.o.id, label } });
      const pressed = Phaser.Input.Keyboard.JustDown(this.keys.e) || Phaser.Input.Keyboard.JustDown(this.keys.space) || this.touch.interact;
      this.touch.interact = false;
      if (pressed) client.interact(best.o.id);
    } else {
      this.promptBubble.setVisible(false);
      if (store.get().prompt) store.set({ prompt: null });
      this.touch.interact = false;
    }

    // Mission marker above the watchtower + an edge arrow when it is off-screen.
    const mission = client.snapshot!.mission;
    const target = map.objects.find((o) => o.id === mission.target_id);
    const active = mission.status === "active" && client.running;
    this.marker.setVisible(!!target && active);
    this.edgeArrow.setVisible(false);
    if (!target || !active) return;
    const tx = (target.x + target.w / 2) * TILE;
    const ty = target.y * TILE - 38;
    const bounce = reduced ? 0 : Math.round(Math.sin(now / 250) * 2);
    this.marker.setPosition(tx, ty + bounce);
    const cam = this.cameras.main;
    const view = cam.worldView;
    if (!view.contains(tx, ty + 20)) {
      const cxw = view.centerX;
      const cyw = view.centerY;
      const ang = Math.atan2(ty - cyw, tx - cxw);
      const margin = 24;
      const hw = cam.width / 2 - margin;
      const hh = cam.height / 2 - margin;
      const k = Math.min(hw / Math.abs(Math.cos(ang) || 1e-6), hh / Math.abs(Math.sin(ang) || 1e-6));
      this.edgeArrow.setVisible(true)
        .setPosition(cam.width / 2 + Math.cos(ang) * k, cam.height / 2 + Math.sin(ang) * k)
        .setRotation(ang - Math.PI / 2)
        .setScale(cam.zoom);
    }
  }

  private promptLabel(o: MapObjectDTO): string {
    const client = this.deps.client;
    if (o.kind === "resource_node") {
      const left = client.snapshot?.nodes[o.id] ?? 0;
      return left > 0 ? `Gather ${String(o.props.resource)} (${left})` : "Depleted";
    }
    if (o.kind === "watchtower") return "Deliver materials";
    return String(o.props.label ?? o.kind);
  }

  private onGameEvent(ev: GameEventDTO): void {
    const client = this.deps.client;
    if (!this.built) return;
    if (ev.type === "resource_gathered" || ev.type === "resources_delivered") {
      const actor = this.actors.get(String(ev.data.contestant));
      if (!actor) return;
      const text = ev.type === "resource_gathered" ? `+1 ${String(ev.data.resource)}` : `+${String(ev.data.points)}`;
      const isMe = ev.data.contestant === client.you;
      if (!isMe && ev.type === "resource_gathered") return;
      this.floatText(actor.sprite.x, actor.sprite.y - FRAME_H - 8, text, isMe ? "#ffe066" : "#d9f0ff");
    }
    if (ev.type === "mission_completed" && this.tower) {
      this.floatText(this.tower.x, this.tower.y - 72, "Repaired!", "#86d35f");
      if (!this.deps.reducedMotion()) this.cameras.main.shake(180, 0.002);
    }
  }

  private floatText(x: number, y: number, text: string, color: string): void {
    const t = this.add
      .text(x, y, text, { fontFamily: "Pixelify Sans, monospace", fontSize: "8px", color, stroke: "#1f1630", strokeThickness: 2 })
      .setResolution(4).setOrigin(0.5, 1).setDepth(990000);
    if (this.deps.reducedMotion()) {
      this.time.delayedCall(700, () => t.destroy());
    } else {
      this.tweens.add({ targets: t, y: y - 14, alpha: 0, duration: 800, ease: "Quad.easeOut", onComplete: () => t.destroy() });
    }
  }
}

export const ARCHETYPE_KEYS = Object.keys(ARCHETYPES);

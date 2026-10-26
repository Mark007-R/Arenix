import * as Phaser from "phaser";
import { ARCHETYPES, FRAME, FRAME_H, buildCharacterSheet, cosmeticKey } from "../art/characters";
import * as Obj from "../art/objects";
import { applyTheme, P } from "../art/palette";
import { TILE, renderTiles } from "../art/tiles";
import type { GameClient } from "../net/client";
import { DT } from "@/shared/physics";
import { loadSettings } from "@/lib/settings";
import type { BodyDTO, ContestantDTO, Facing, GameEventDTO, MapObjectDTO } from "@/shared/protocol";

const STEP_MS = DT * 1000;
const INTERP_DELAY_MS = 100;
const DIR_INDEX: Record<Facing, number> = { down: 0, up: 1, left: 2, right: 2 };

interface ActorView {
  bubble: Phaser.GameObjects.Text | null;
  bubbleUntil: number;
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
  private beaconSprites = new Map<string, Phaser.GameObjects.Image>();
  private bodySprites = new Map<string, Phaser.GameObjects.GameObject[]>();
  private tower: Phaser.GameObjects.Image | null = null;
  private towerRepaired = false;
  private marker!: Phaser.GameObjects.Image;
  private edgeArrow!: Phaser.GameObjects.Image;
  private promptBubble!: Phaser.GameObjects.Text;
  private killBubble!: Phaser.GameObjects.Text;
  private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d" | "e" | "space" | "k", Phaser.Input.Keyboard.Key>;
  private acc = 0;
  private lastFrame = 0;
  private localFacing: Facing = "down";
  private localMoving = false;
  private built = false;
  private unsub: (() => void) | null = null;
  /** Touch joystick vector, set by the React overlay. */
  touch = { dx: 0, dy: 0, interact: false, kill: false };

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
      w: K.W, a: K.A, s: K.S, d: K.D, e: K.E, space: K.SPACE, k: K.K,
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
    applyTheme(map.theme);
    this.cameras.main.setBackgroundColor(P.waterDark);
    this.add.image(0, 0, this.texture(`tiles-${map.id}`, () => renderTiles(map))).setOrigin(0, 0).setDepth(-100000);

    for (const o of map.objects) this.addObject(o);

    this.marker = this.add.image(0, 0, this.texture("arrow", Obj.arrow)).setOrigin(0.5, 1).setDepth(900000);
    this.edgeArrow = this.add.image(0, 0, "arrow").setDepth(950000).setScrollFactor(0).setVisible(false);
    this.promptBubble = this.add
      .text(0, 0, "", { fontFamily: "Pixelify Sans, monospace", fontSize: "8px", color: "#fbf7ee",
        backgroundColor: "#1f1630", padding: { x: 3, y: 1 } })
      .setResolution(4).setOrigin(0.5, 1).setDepth(960000).setVisible(false);
    this.killBubble = this.add
      .text(0, 0, "", { fontFamily: "Pixelify Sans, monospace", fontSize: "8px", color: "#fbf7ee",
        backgroundColor: "#9a3029", padding: { x: 3, y: 1 } })
      .setResolution(4).setOrigin(0.5, 1).setDepth(960001).setVisible(false);

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
      case "beacon": {
        this.texture("beacon-lit", () => Obj.beacon(true));
        this.texture("beacon-dark", () => Obj.beacon(false));
        const img = this.add.image(cx, bottom, "beacon-dark").setOrigin(0.5, 1).setDepth(bottom);
        this.beaconSprites.set(o.id, img);
        return;
      }
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
    const look = cosmeticKey(c.archetype, c.cosmetics);
    const sheetKey = `char-${look}`;
    if (!this.textures.exists(sheetKey)) {
      const tex = this.textures.addCanvas(sheetKey, buildCharacterSheet(c.archetype, c.cosmetics))!;
      for (let i = 0; i < 9; i++) tex.add(i, 0, i * FRAME, 0, FRAME, FRAME_H);
      for (let d = 0; d < 3; d++) {
        this.anims.create({
          key: `${look}-walk-${d}`,
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
    a = { sprite, shadow, label, carry, archetype: look, lastX: c.x, lastY: c.y, bubble: null, bubbleUntil: 0 };
    this.actors.set(c.id, a);
    if (isMe) this.cameras.main.startFollow(sprite, true, 0.2, 0.2, 0, 8);
    return a;
  }

  private readInput(): [number, number] {
    if (this.deps.client.store.get().typing) return [0, 0];
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

    const present = new Set(snap.contestants.map((c) => c.id));
    for (const [id, a] of this.actors) {
      if (!present.has(id)) this.setActorVisible(a, false);
    }
    for (const c of snap.contestants) {
      const a = this.ensureActor(c);
      this.setActorVisible(a, true);
      let x: number;
      let y: number;
      let facing: Facing = c.facing;
      let moving = c.moving;
      if (c.id === client.you && client.predictor) {
        const p = client.predictor;
        x = client.prev.x + (p.x - client.prev.x) * alpha + client.correction.x;
        y = client.prev.y + (p.y - client.prev.y) * alpha + client.correction.y;
        facing = this.localFacing;
        moving = this.localMoving && client.canMove && (Math.abs(p.x - client.prev.x) + Math.abs(p.y - client.prev.y) > 1e-6);
      } else {
        const s = client.buffers.get(c.id)?.sample(now - INTERP_DELAY_MS);
        x = s?.x ?? c.x;
        y = s?.y ?? c.y;
      }
      this.placeActor(a, c, x, y, facing, moving, reduced, now);
    }

    this.updateWorldState(snap.nodes, snap.mission.status === "completed");
    this.updateBeaconsAndBodies(snap.beacons, snap.bodies ?? []);
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
    a.sprite.setAlpha(!c.alive ? 0.4 : c.connected ? 1 : 0.5);
    a.shadow.setVisible(a.sprite.visible && c.alive);
    const fellow = this.deps.client.snapshot?.me?.fellow_impostors?.includes(c.id);
    a.label.setColor(c.id === this.deps.client.you ? "#ffe066" : fellow ? "#ff6b5e" : "#fbf7ee");
    a.label.setText(c.alive ? c.name : `👻 ${c.name}`);
    if (a.bubble) {
      if (now > a.bubbleUntil) {
        a.bubble.destroy();
        a.bubble = null;
      } else {
        a.bubble.setPosition(px, py - FRAME_H - 14).setDepth(970000);
      }
    }
  }

  private setActorVisible(a: ActorView, visible: boolean): void {
    if (a.sprite.visible === visible) return;
    a.sprite.setVisible(visible);
    a.shadow.setVisible(visible);
    a.label.setVisible(visible);
    a.bubble?.setVisible(visible);
    if (!visible) a.carry.forEach((img) => img.setVisible(false));
  }

  private showBubble(id: string, text: string, whisper: boolean): void {
    const a = this.actors.get(id);
    if (!a) return;
    a.bubble?.destroy();
    const short = text.length > 42 ? `${text.slice(0, 40)}…` : text;
    a.bubble = this.add
      .text(a.sprite.x, a.sprite.y - FRAME_H - 14, short, {
        fontFamily: "Pixelify Sans, monospace", fontSize: "7px",
        color: whisper ? "#d8c2ff" : "#1f1630",
        backgroundColor: whisper ? "#43305c" : "#fbf7ee",
        padding: { x: 3, y: 2 },
        wordWrap: { width: 110 },
        align: "center",
      })
      .setResolution(4).setOrigin(0.5, 1).setDepth(970000).setVisible(a.sprite.visible);
    a.bubbleUntil = performance.now() + 4000;
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

  private updateBeaconsAndBodies(beacons: Record<string, boolean> | undefined, bodies: BodyDTO[]): void {
    if (beacons) {
      for (const [id, img] of this.beaconSprites) {
        const want = beacons[id] ? "beacon-lit" : "beacon-dark";
        if (img.texture.key !== want) img.setTexture(want);
      }
    }
    const client = this.deps.client;
    const present = new Set(bodies.map((b) => b.id));
    for (const [id, parts] of this.bodySprites) {
      if (!present.has(id)) {
        parts.forEach((p) => p.destroy());
        this.bodySprites.delete(id);
      }
    }
    for (const b of bodies) {
      if (this.bodySprites.has(b.id)) continue;
      const victim = client.snapshot?.roster.find((r) => r.id === b.victim);
      const px = Math.round(b.x * TILE);
      const py = Math.round(b.y * TILE);
      const mark = this.add.image(px, py + 2, this.texture("body-mark", Obj.bodyMark)).setOrigin(0.5, 0.5).setDepth(py - 2);
      const parts: Phaser.GameObjects.GameObject[] = [mark];
      if (victim) {
        const look = cosmeticKey(victim.archetype, victim.cosmetics);
        const sheetKey = `char-${look}`;
        if (!this.textures.exists(sheetKey)) {
          const tex = this.textures.addCanvas(sheetKey, buildCharacterSheet(victim.archetype, victim.cosmetics))!;
          for (let i = 0; i < 9; i++) tex.add(i, 0, i * FRAME, 0, FRAME, FRAME_H);
        }
        const lying = this.add.sprite(px, py, sheetKey, 0).setOrigin(0.5, 0.5).setAngle(90).setTint(0x9a8fb0).setDepth(py - 1);
        parts.push(lying);
      }
      this.bodySprites.set(b.id, parts);
    }
  }

  private updatePromptAndMarker(reduced: boolean, now: number): void {
    const client = this.deps.client;
    const map = client.map!;
    const p = client.predictor;
    const range = client.constants?.interact_range ?? 1.3;
    const store = client.store;

    // Contextual interaction prompt for the nearest interactable in range. Bodies come first.
    let best: { o: MapObjectDTO; d: number } | null = null;
    if (p && client.canAct) {
      const reportRange = client.constants?.report_range ?? 2;
      for (const b of client.snapshot?.bodies ?? []) {
        const d = Math.hypot(p.x - b.x, p.y - b.y) - 10; // always wins over objects
        if (d + 10 <= reportRange && (!best || d < best.d)) {
          best = {
            o: { id: b.id, kind: "body", x: b.x - 0.5, y: b.y - 0.5, w: 1, h: 1, solid: false, interactable: true,
              props: { victim: b.victim } },
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
      this.promptBubble.setText(`E  ${label}`).setVisible(true)
        .setPosition((best.o.x + best.o.w / 2) * TILE, best.o.kind === "watchtower" ? (best.o.y + best.o.h) * TILE - 48 : best.o.y * TILE - 8);
      const cur = store.get().prompt;
      if (cur?.targetId !== best.o.id || cur.label !== label) store.set({ prompt: { targetId: best.o.id, label } });
      const typing = store.get().typing;
      const pressed = (!typing && (Phaser.Input.Keyboard.JustDown(this.keys.e) || Phaser.Input.Keyboard.JustDown(this.keys.space))) || this.touch.interact;
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
    const active = mission.status === "active" && client.canAct;
    this.marker.setVisible(!!target && active);
    this.edgeArrow.setVisible(false);
    if (!target || !active) return;
    const tx = (target.x + target.w / 2) * TILE;
    // Just above the ruined stump (the repaired tower is taller, but the marker hides by then).
    const ty = (target.y + target.h) * TILE - 38;
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

  /**
   * Impostors: the closest islander within kill range, when the knife is ready. Sheriff: the closest
   * contestant within shooting range, while the bullet is unfired. K (or the HUD button) strikes.
   */
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
      // The server judges range from its own (slightly older) position of us, not our prediction.
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
    // Read the key every frame so a press with nobody in reach is not replayed later.
    const pressed = Phaser.Input.Keyboard.JustDown(this.keys.k) || this.touch.kill;
    this.touch.kill = false;
    const cur = store.get().killTarget;
    if ((cur?.id ?? null) !== (target?.id ?? null)) {
      store.set({ killTarget: target ? { id: target.id, name: target.name } : null });
    }
    if (target) {
      const a = this.actors.get(target.id);
      this.killBubble.setText(`K  ${sheriff ? "Shoot" : "Eliminate"} ${target.name}`).setVisible(true)
        .setPosition(a?.sprite.x ?? target.x * TILE, (a?.sprite.y ?? target.y * TILE) - FRAME_H - 16);
      if (pressed && !store.get().typing) {
        if (sheriff) client.shoot(target.id);
        else client.kill(target.id);
      }
    } else {
      this.killBubble.setVisible(false);
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
    if (!this.built) return;
    if (ev.type === "chat") {
      const s = loadSettings();
      if (client.isMuted(String(ev.data.sender)) || !s.bubbles || (s.hideChat && ev.data.sender !== client.you)) return;
      this.showBubble(String(ev.data.sender), String(ev.data.text), !!ev.data.private);
      return;
    }
    if (ev.type === "resource_gathered" || ev.type === "resources_delivered") {
      const actor = this.actors.get(String(ev.data.contestant));
      if (!actor) return;
      const effect = client.contestant(String(ev.data.contestant))?.cosmetics?.effect;
      const base = ev.type === "resource_gathered" ? `+1 ${String(ev.data.resource)}` : `+${String(ev.data.points)}`;
      const text = effect && ev.type === "resources_delivered" ? `${effect.glyph} ${base} ${effect.glyph}` : base;
      const isMe = ev.data.contestant === client.you;
      if (!isMe && ev.type === "resource_gathered") return;
      this.floatText(actor.sprite.x, actor.sprite.y - FRAME_H - 8, text, effect?.color ?? (isMe ? "#ffe066" : "#d9f0ff"));
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

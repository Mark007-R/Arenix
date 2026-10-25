import { step, type SolidFn } from "./physics";

export interface PendingInput {
  seq: number;
  dx: number;
  dy: number;
}

/**
 * Client-side prediction with server reconciliation.
 *
 * Each fixed tick the client applies its own input immediately and remembers it. When a
 * snapshot arrives carrying the last input sequence the server processed (ackSeq) and the
 * authoritative position, we rewind to that position and replay the inputs the server has
 * not seen yet. Because physics is bit-identical, corrections only happen when the server
 * actually disagreed (e.g. dropped inputs).
 */
export class Predictor {
  x: number;
  y: number;
  /** Movement multiplier from the player's skill (Swift); must match the server's. */
  speed = 1;
  private pending: PendingInput[] = [];
  private nextSeq: number;

  constructor(
    private readonly solid: SolidFn,
    x: number,
    y: number,
    /** Last sequence number the server already saw from us (non-zero after a reconnect). */
    resumeSeq = 0,
  ) {
    this.x = x;
    this.y = y;
    this.nextSeq = resumeSeq + 1;
  }

  /** Apply a local input and return the message to send. */
  applyLocal(dx: number, dy: number): PendingInput {
    const input = { seq: this.nextSeq++, dx, dy };
    [this.x, this.y] = step(this.solid, this.x, this.y, dx, dy, this.speed);
    this.pending.push(input);
    if (this.pending.length > 120) this.pending.shift();
    return input;
  }

  /** Returns the size of the correction (tiles) so callers can smooth visible snaps. */
  reconcile(ackSeq: number, serverX: number, serverY: number): number {
    const beforeX = this.x;
    const beforeY = this.y;
    this.pending = this.pending.filter((p) => p.seq > ackSeq);
    let x = serverX;
    let y = serverY;
    for (const p of this.pending) [x, y] = step(this.solid, x, y, p.dx, p.dy, this.speed);
    this.x = x;
    this.y = y;
    return Math.hypot(x - beforeX, y - beforeY);
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}

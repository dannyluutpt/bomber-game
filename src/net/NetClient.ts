import Peer, { type DataConnection } from "peerjs";
import type { CharacterId, DifficultyId, Direction, GameSnapshot } from "../simulation/types";

// --- Wire protocol -----------------------------------------------------------
// Messages exchanged over the WebRTC DataChannel. Kept small & JSON-serialisable.
// joiner -> host: char (pick), dir (held direction), bomb (discrete), restart
// host -> joiner: start (begin match), snap (authoritative snapshot each tick)
export type NetMessage =
  | { t: "char"; id: CharacterId }
  | { t: "dir"; dir: Direction | null }
  | { t: "bomb" }
  | { t: "restart" }
  | { t: "start"; seed: number; difficulty: DifficultyId; characters: [CharacterId, CharacterId] }
  | { t: "snap"; s: GameSnapshot };

export type NetRole = "none" | "host" | "joiner";

// PeerJS error objects carry a `.type` discriminator we care about.
interface PeerError extends Error { type?: string; }

const ROOM_ID_PREFIX = "bombpix-"; // namespace on the shared public broker so our
                                   // 6-digit codes don't collide with other PeerJS apps

/**
 * Thin wrapper around PeerJS for 1-host / 1-joiner sessions.
 * The 6-digit room code IS the host's broker ID — uniqueness is enforced by the
 * broker rejecting duplicate IDs, so no central database is needed.
 */
export class NetClient {
  role: NetRole = "none";
  code: string | null = null;

  // Consumer callbacks (set by GameScene). All optional / no-op until assigned.
  onMessage: (msg: NetMessage) => void = () => {};
  onPeerConnect: () => void = () => {};   // fired once the data channel is open (both sides)
  onPeerClose: () => void = () => {};     // peer left / connection dropped
  onError: (reason: string) => void = () => {};

  private peer: Peer | null = null;
  private conn: DataConnection | null = null;

  /**
   * Create a room. Resolves with the 6-digit code once the broker has accepted it.
   *
   * Room-code uniqueness strategy (the interesting decision):
   *   We register on the broker using the code itself as the peer ID. If that ID is
   *   already taken the broker emits an "unavailable-id" error and we retry with a
   *   fresh random code, up to `maxAttempts` times. This trades a (tiny) chance of a
   *   few retries for zero server-side bookkeeping.
   */
  host(maxAttempts = 8): Promise<string> {
    this.role = "host";
    return new Promise<string>((resolve, reject) => {
      const attempt = (remaining: number) => {
        const code = generateRoomCode();
        const peer = new Peer(ROOM_ID_PREFIX + code);
        this.peer = peer;

        peer.on("open", () => {
          this.code = code;
          resolve(code);
        });

        // The host waits for exactly one joiner to dial in.
        peer.on("connection", (conn) => {
          this.attachConnection(conn);
        });

        peer.on("error", (err: PeerError) => {
          if (err.type === "unavailable-id" && remaining > 0) {
            // Code collision: throw this peer away and try a brand-new code.
            peer.destroy();
            attempt(remaining - 1);
            return;
          }
          this.onError(describeError(err));
          if (!this.code) reject(err); // only reject if we never got a code
        });
      };
      attempt(maxAttempts);
    });
  }

  /**
   * Join an existing room by its 6-digit code. Resolves once the data channel opens.
   * Rejects if the code is invalid / nobody is hosting it.
   */
  join(code: string): Promise<void> {
    this.role = "joiner";
    this.code = code;
    return new Promise<void>((resolve, reject) => {
      const peer = new Peer(); // let the broker assign us a random id
      this.peer = peer;

      peer.on("open", () => {
        // Reliable, ordered channel: snapshots tolerate loss, but dropping a "bomb"
        // or direction-change input would be very noticeable, so we never drop.
        const conn = peer.connect(ROOM_ID_PREFIX + code, { reliable: true });
        this.attachConnection(conn, resolve);
      });

      peer.on("error", (err: PeerError) => {
        const reason = err.type === "peer-unavailable"
          ? "Không tìm thấy phòng. Kiểm tra lại mã."
          : describeError(err);
        this.onError(reason);
        reject(new Error(reason));
      });
    });
  }

  send(msg: NetMessage): void {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  destroy(): void {
    this.conn?.close();
    this.peer?.destroy();
    this.conn = null;
    this.peer = null;
    this.role = "none";
    this.code = null;
  }

  private attachConnection(conn: DataConnection, onOpen?: () => void): void {
    this.conn = conn;
    conn.on("open", () => {
      this.onPeerConnect();
      onOpen?.();
    });
    conn.on("data", (data) => this.onMessage(data as NetMessage));
    conn.on("close", () => this.onPeerClose());
    conn.on("error", (err: PeerError) => this.onError(describeError(err)));
  }
}

/** Random 6-digit code as a string, zero-padded (e.g. "042137"). */
function generateRoomCode(): string {
  return Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
}

function describeError(err: PeerError): string {
  return `Lỗi kết nối: ${err.type ?? err.message ?? "không xác định"}`;
}

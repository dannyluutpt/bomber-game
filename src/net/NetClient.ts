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

// Give up (and tell the user) if the data channel hasn't opened in this long.
// A working connection completes in a few seconds; anything beyond this is a
// NAT/firewall traversal failure that would otherwise hang forever.
const CONNECT_TIMEOUT_MS = 20000;

// --- WebRTC ICE configuration ------------------------------------------------
// STUN lets two peers discover their public IP and punch a direct path. This
// covers most home Wi-Fi routers (cone NAT).
//
// TURN *relays* the traffic through a server when a direct path is impossible —
// needed for symmetric NAT (common on mobile data, corporate, and CGNAT). With no
// TURN server, those players stay stuck on "connecting" (now surfaced as a timeout).
//
// There is NO reliable zero-signup public TURN server, so TURN is intentionally
// left empty for you to fill in (see TURN_SERVERS below).
const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" }
];

// TURN relay (Metered free tier) — required for players behind strict/symmetric
// NAT (mobile data, corporate, CGNAT). These are *static long-lived* credentials
// meant to live in the client; the account API key is deliberately NOT here.
// Verified working with relay-only ICE. To rotate, regenerate at dashboard.metered.ca.
const TURN_USER = "74e110b195fc7765a6fbfb42";
const TURN_PASS = "Us9naHQGPaqkvmLx";
const TURN_SERVERS: RTCIceServer[] = [
  { urls: "turn:global.relay.metered.ca:80", username: TURN_USER, credential: TURN_PASS },
  { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: TURN_USER, credential: TURN_PASS },
  { urls: "turn:global.relay.metered.ca:443", username: TURN_USER, credential: TURN_PASS },
  { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: TURN_USER, credential: TURN_PASS }
];

const PEER_CONFIG = { config: { iceServers: [...STUN_SERVERS, ...TURN_SERVERS] } };

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
  private connectTimer: ReturnType<typeof setTimeout> | null = null;

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
        const peer = new Peer(ROOM_ID_PREFIX + code, PEER_CONFIG);
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
      const peer = new Peer(PEER_CONFIG); // broker assigns us a random id (options-only overload)
      this.peer = peer;

      // Fail loudly instead of hanging forever if traversal never completes.
      this.connectTimer = setTimeout(() => {
        if (this.conn?.open) return;
        this.onError("Kết nối quá lâu — có thể do tường lửa/NAT chặn. Thử lại, hoặc cần TURN server (xem TURN_SERVERS).");
        reject(new Error("connection timeout"));
        this.destroy();
      }, CONNECT_TIMEOUT_MS);

      peer.on("open", () => {
        // Reliable, ordered channel: snapshots tolerate loss, but dropping a "bomb"
        // or direction-change input would be very noticeable, so we never drop.
        const conn = peer.connect(ROOM_ID_PREFIX + code, { reliable: true });
        logIceState(conn);
        this.attachConnection(conn, resolve);
      });

      peer.on("error", (err: PeerError) => {
        const reason = err.type === "peer-unavailable"
          ? "Không tìm thấy phòng. Kiểm tra lại mã."
          : describeError(err);
        this.onError(reason);
        this.clearConnectTimer();
        reject(new Error(reason));
      });
    });
  }

  send(msg: NetMessage): void {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  destroy(): void {
    this.clearConnectTimer();
    this.conn?.close();
    this.peer?.destroy();
    this.conn = null;
    this.peer = null;
    this.role = "none";
    this.code = null;
  }

  private clearConnectTimer(): void {
    if (this.connectTimer !== null) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private attachConnection(conn: DataConnection, onOpen?: () => void): void {
    this.conn = conn;
    conn.on("open", () => {
      this.clearConnectTimer();
      this.onPeerConnect();
      onOpen?.();
    });
    conn.on("data", (data) => this.onMessage(data as NetMessage));
    conn.on("close", () => this.onPeerClose());
    conn.on("error", (err: PeerError) => {
      this.clearConnectTimer();
      this.onError(describeError(err));
    });
  }
}

// Log the underlying ICE connection state so a stuck "connecting" is diagnosable
// from the browser console (look for "[net] ICE: ..."). No-op once connected/closed.
function logIceState(conn: DataConnection): void {
  const start = Date.now();
  const timer = setInterval(() => {
    const pc = conn.peerConnection;
    const state = pc?.iceConnectionState;
    if (state) console.info(`[net] ICE: ${state} (${Date.now() - start}ms)`);
    if (!state || state === "connected" || state === "completed" ||
        state === "failed" || state === "closed" || Date.now() - start > CONNECT_TIMEOUT_MS) {
      clearInterval(timer);
    }
  }, 1000);
}

/** Random 6-digit code as a string, zero-padded (e.g. "042137"). */
function generateRoomCode(): string {
  return Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
}

function describeError(err: PeerError): string {
  return `Lỗi kết nối: ${err.type ?? err.message ?? "không xác định"}`;
}

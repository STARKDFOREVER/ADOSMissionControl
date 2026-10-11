/** A raw UDP/TCP MAVLink endpoint the desktop app opens natively (browsers cannot). */
interface ElectronNetOpenSpec {
  proto: "udp" | "tcp";
  host: string;
  port: number;
  /** UDP only. "listen" binds host:port and learns the peer from the first
   *  MAVLink datagram (the common autopilot case), re-learning only after 3 s
   *  of silence; "target" sends to a fixed host:port.
   *  Ignored for TCP (always a client connect). */
  mode?: "listen" | "target";
}
interface ElectronNetDataMessage {
  id: string;
  data: Uint8Array;
}
interface ElectronNetCloseMessage {
  id: string;
  reason?: string;
}
/** A listen-mode UDP socket replaced a peer that had gone silent. */
interface ElectronNetPeerMessage {
  id: string;
  host: string;
  port: number;
}
/** Native UDP/TCP socket bridge owned by the Electron main process. The renderer
 *  only ever holds an opaque socket id; the real socket never leaves main. */
interface ElectronNetAPI {
  open: (spec: ElectronNetOpenSpec) => Promise<{ id: string }>;
  /** Fire-and-forget: a frame for an unknown id is ignored. */
  send: (id: string, data: Uint8Array) => void;
  close: (id: string) => Promise<void>;
  /** Subscribe to inbound bytes for any open socket. Returns an unsubscribe. */
  onData: (cb: (msg: ElectronNetDataMessage) => void) => () => void;
  /** Subscribe to socket close/error events. Returns an unsubscribe. */
  onClose: (cb: (msg: ElectronNetCloseMessage) => void) => () => void;
  /** Subscribe to listen-mode peer re-learns. Returns an unsubscribe. */
  onPeer: (cb: (msg: ElectronNetPeerMessage) => void) => () => void;
}

/** Update status the main process pushes; mirrors `UpdateStatus` in electron/updater.ts. */
export type ElectronUpdateStatus =
  | { state: "idle" }
  /** `installable` is false where only a manual download from `releasesUrl` works. */
  | { state: "available"; version: string; installable: boolean; releasesUrl: string }
  | { state: "downloading"; version: string }
  | { state: "downloaded"; version: string }
  /** The release channel could not be reached; normal for an offline GCS. */
  | { state: "check-failed"; message: string }
  /** A download or install failed; a failed download can be retried. */
  | { state: "error"; phase: "download" | "install"; message: string };

interface ElectronUpdatesAPI {
  /** The latest status, including a result that arrived before this page mounted. */
  status: () => Promise<ElectronUpdateStatus>;
  /** Subscribe to status changes. Returns an unsubscribe. */
  onStatus: (cb: (status: ElectronUpdateStatus) => void) => () => void;
  /** Download the available version. Rejects where this build cannot install. */
  download: () => Promise<void>;
  /** Quit and install the downloaded version. */
  install: () => Promise<void>;
  /** Check the release channel now; resolves with the resulting status. */
  check: () => Promise<ElectronUpdateStatus>;
}

/** Seals paired-node API keys with the OS key store (Electron `safeStorage`)
 *  in the main process. Only ciphertext reaches the renderer's storage. */
interface ElectronLocalNodesAPI {
  /** Base64 ciphertext, or null when this OS offers no key store. */
  encrypt: (key: string) => Promise<string | null>;
  /** The key sealed in `sealed` (base64); rejects when it cannot be opened. */
  decrypt: (sealed: string) => Promise<string>;
}

interface ElectronAPI {
  isElectron: true;
  platform: "darwin" | "win32" | "linux";
  updates: ElectronUpdatesAPI;
  /** Native UDP/TCP MAVLink sockets — desktop builds only (absent in browsers). */
  net?: ElectronNetAPI;
  /** Paired-node key sealing — desktop builds only (absent in browsers). */
  localNodes?: ElectronLocalNodesAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};

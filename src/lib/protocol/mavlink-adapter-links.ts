/**
 * MAVLink adapter — multi-link management.
 *
 * Owns every transport (link) that reaches one drone: per-link parsers,
 * outbound signing, frame fan-out, primary/command link selection, inbound
 * signature verification counters, and the add-link sysid check.
 *
 * @module protocol/mavlink-adapter-links
 */

import type { Transport, LinkInfo } from './types'
import { MAVLinkParser, type MAVLinkFrame } from './mavlink-parser'
import { decodeHeartbeat, type HeartbeatMsg } from './messages'
import { isAutopilotHeartbeat } from './heartbeat-source'
import { SigningTransport } from './signing-transport'
import type { MavlinkSigner } from './mavlink-signer'
import type { ConnectionMeta } from '@/lib/connection-meta'
import { useSigningStore, type LinkSigningCounters } from '@/stores/signing-store'
import { useSettingsStore } from '@/stores/settings-store'

/** Per-link state for multi-link support. Each link is a Transport that can reach this drone. */
export interface LinkState {
  id: string
  transport: Transport
  /** `transport` as seen by senders: signs each v2 frame while a signer is set. */
  outbound: SigningTransport
  /**
   * This link's own frame parser. A parser holds partial frames between
   * chunks, so two links sharing one would splice a chunk from one link into
   * a frame from the other and lose both to the CRC check.
   */
  parser: MAVLinkParser
  label: string
  connectionMeta?: ConnectionMeta
  connectedAt: number
  /** Last time bytes were received on this link (ms) — used for "primary" selection */
  lastByteAt: number
  dataHandler: (data: Uint8Array) => void
  closeHandler: () => void
  /** Inbound signature tallies; see {@link LinkSigningCounters}. */
  tally: { frames: number; signed: number; ok: number; bad: number; verifierBad: number }
  /** Counters last written to the signing store. */
  flushed: LinkSigningCounters | null
}

export type LinkFrameListener = (frame: MAVLinkFrame, linkId: string) => void

/** How often per-link signing counters are written to the signing store. */
const COUNTER_FLUSH_MS = 1000

let _linkIdCounter = 0
const nextLinkId = () => `link-${++_linkIdCounter}-${Date.now()}`

/** The full signed frame (STX through the 13-byte tail) from the parser's pieces. */
function joinSigned(signedRegion: Uint8Array, sigTail: Uint8Array): Uint8Array {
  const frame = new Uint8Array(signedRegion.length + sigTail.length)
  frame.set(signedRegion)
  frame.set(sigTail, signedRegion.length)
  return frame
}

export class LinkSet {
  readonly links = new Map<string, LinkState>()
  private frameListeners: LinkFrameListener[] = []
  private signer: MavlinkSigner | null = null
  private enforce = false
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private unsubSettings: (() => void) | null = null

  /**
   * @param onFrame Every frame accepted on any link, before the listeners.
   * @param onLinkClosed A link's transport closed on its own.
   */
  constructor(
    private readonly onFrame: (frame: MAVLinkFrame, linkId: string) => void,
    private readonly onLinkClosed: (linkId: string) => void,
  ) {}

  /** Sign outbound (and verify inbound) with `signer`; null sends unsigned. */
  setSigner(signer: MavlinkSigner | null): void {
    this.signer = signer
    this.applyVerifiers()
  }

  /**
   * The "primary" transport — the link with the most recent byte activity.
   * This is the liveness notion, deliberately not the send target: the
   * busiest link can be receive-only.
   */
  get primary(): Transport | null {
    let primary: LinkState | null = null
    for (const link of this.links.values()) {
      if (!primary || link.lastByteAt > primary.lastByteAt) primary = link
    }
    return primary?.transport ?? null
  }

  /**
   * The link every outbound byte goes through: the most recently active link
   * that can command. When none can, the primary, so downstream `canCommand`
   * refusals read the real link state instead of "Not connected".
   */
  get commandTransport(): Transport | null {
    let best: LinkState | null = null
    let primary: LinkState | null = null
    for (const link of this.links.values()) {
      if (!primary || link.lastByteAt > primary.lastByteAt) primary = link
      if (!link.transport.canCommand || !link.transport.isConnected) continue
      if (!best || link.lastByteAt > best.lastByteAt) best = link
    }
    return (best ?? primary)?.outbound ?? null
  }

  /** Information about every active link, oldest first. */
  info(): LinkInfo[] {
    const primaryTransport = this.primary
    const result: LinkInfo[] = []
    for (const link of this.links.values()) {
      result.push({
        id: link.id,
        type: link.transport.type,
        label: link.label,
        isConnected: link.transport.isConnected,
        connectedAt: link.connectedAt,
        lastByteAt: link.lastByteAt,
        isPrimary: link.transport === primaryTransport,
      })
    }
    return result.sort((a, b) => a.connectedAt - b.connectedAt)
  }

  /** Attach a transport as a link. */
  attach(transport: Transport, label: string, meta?: ConnectionMeta): LinkState {
    const id = nextLinkId()
    const parser = new MAVLinkParser()
    const link: LinkState = {
      id,
      transport,
      outbound: new SigningTransport(transport, () => this.signer),
      parser,
      label,
      connectionMeta: meta,
      connectedAt: Date.now(),
      lastByteAt: 0,
      dataHandler: (data: Uint8Array) => {
        link.lastByteAt = Date.now()
        parser.feed(data)
      },
      closeHandler: () => this.onLinkClosed(id),
      tally: { frames: 0, signed: 0, ok: 0, bad: 0, verifierBad: 0 },
      flushed: null,
    }
    parser.onFrame((frame) => {
      link.tally.frames++
      this.dispatch(frame, id)
    })
    parser.onSignedFrame(({ signedRegion, sigTail }) => {
      link.tally.signed++
      // Under enforcement the parser's verifier already counted this frame.
      if (this.enforce || !this.signer) return
      if (this.signer.verifyFrame(joinSigned(signedRegion, sigTail))) link.tally.ok++
      else link.tally.bad++
    })
    transport.on('data', link.dataHandler)
    transport.on('close', link.closeHandler as (data: void) => void)
    this.links.set(id, link)
    if (this.links.size === 1) this.startWatching()
    this.applyVerifier(link)
    return link
  }

  /** Detach a single link's transport handlers (does not disconnect the transport). */
  detach(link: LinkState): void {
    link.transport.off('data', link.dataHandler)
    link.transport.off('close', link.closeHandler as (data: void) => void)
    link.parser.reset()
    this.links.delete(link.id)
    useSigningStore.getState().clearLink(link.id)
    if (this.links.size === 0) this.stopWatching()
  }

  /** Observe every frame on every link, told which link delivered it. */
  listen(listener: LinkFrameListener): () => void {
    this.frameListeners.push(listener)
    return () => {
      const i = this.frameListeners.indexOf(listener)
      if (i !== -1) this.frameListeners.splice(i, 1)
    }
  }

  /**
   * Wait for the first autopilot HEARTBEAT on `link`. A companion computer,
   * gimbal or camera on the vehicle's sysid never wins: every command would
   * target it instead of the FC. Both exits remove the listener and the timer
   * (a failed connect used to leave both behind, and each retry added
   * another); a timeout also detaches the link.
   * `onLock` runs synchronously on that frame, before any later frame of the
   * same chunk is routed.
   */
  awaitAutopilot<T>(link: LinkState, timeoutMs: number, onLock: (frame: MAVLinkFrame, hb: HeartbeatMsg) => T): Promise<T> {
    const { promise, resolve, reject } = Promise.withResolvers<T>()
    const timeout = setTimeout(() => {
      unsub()
      this.detach(link)
      reject(new Error(`No heartbeat received within ${timeoutMs / 1000} seconds`))
    }, timeoutMs)
    const unsub = this.listen((frame, linkId) => {
      if (linkId !== link.id || frame.msgId !== 0) return
      const hb = decodeHeartbeat(frame.payload)
      if (!isAutopilotHeartbeat(hb)) return
      clearTimeout(timeout); unsub()
      resolve(onLock(frame, hb))
    })
    return promise
  }

  /**
   * Wait for an autopilot heartbeat on `link` and check it reaches
   * `expectedSysId`. A mismatch or 10 s of silence detaches the link.
   */
  verifyNewLink(link: LinkState, expectedSysId: number): Promise<{ ok: true; linkId: string } | { ok: false; error: string }> {
    const { promise, resolve } = Promise.withResolvers<{ ok: true; linkId: string } | { ok: false; error: string }>()
    const timeout = setTimeout(() => {
      unsub()
      this.detach(link)
      resolve({ ok: false, error: 'No heartbeat received on new link within 10 seconds' })
    }, 10000)
    const unsub = this.listen((frame, linkId) => {
      // Only a heartbeat that arrived on *this* link says anything about
      // where this link reaches.
      if (linkId !== link.id || frame.msgId !== 0) return
      if (!isAutopilotHeartbeat(decodeHeartbeat(frame.payload))) return
      clearTimeout(timeout); unsub()
      if (frame.systemId !== expectedSysId) {
        this.detach(link)
        resolve({
          ok: false,
          error: `Sysid mismatch: this transport reaches sysid ${frame.systemId} but expected ${expectedSysId}`,
        })
        return
      }
      resolve({ ok: true, linkId: link.id })
    })
    return promise
  }

  private dispatch(frame: MAVLinkFrame, linkId: string): void {
    this.onFrame(frame, linkId)
    for (const listener of [...this.frameListeners]) {
      try {
        listener(frame, linkId)
      } catch (err) {
        console.warn('[MAVLink] frame listener threw, continuing', err)
      }
    }
  }

  /** Enforcement needs both the setting and a key to verify with. */
  private applyVerifiers(): void {
    for (const link of this.links.values()) this.applyVerifier(link)
  }

  private applyVerifier(link: LinkState): void {
    const signer = this.signer
    if (!this.enforce || !signer) {
      link.parser.setVerifier(null)
      return
    }
    link.parser.setVerifier((frame) => {
      const ok = signer.verifyFrame(frame)
      if (ok) link.tally.ok++
      else link.tally.verifierBad++
      return ok
    })
  }

  private startWatching(): void {
    this.enforce = useSettingsStore.getState().enforceInboundSigning
    this.unsubSettings = useSettingsStore.subscribe((s) => {
      if (s.enforceInboundSigning === this.enforce) return
      this.enforce = s.enforceInboundSigning
      this.applyVerifiers()
    })
    this.flushTimer = setInterval(() => this.flushCounters(), COUNTER_FLUSH_MS)
  }

  private stopWatching(): void {
    this.unsubSettings?.()
    this.unsubSettings = null
    clearInterval(this.flushTimer ?? undefined)
    this.flushTimer = null
  }

  /** Write each link's counters to the signing store when they changed. */
  flushCounters(): void {
    const store = useSigningStore.getState()
    for (const link of this.links.values()) {
      const t = link.tally
      // Frames dropped by the enforcing verifier never reach onFrame: a
      // dropped frame that never reached the verifier was unsigned.
      const rejected = link.parser.signatureRejectCount
      const counters: LinkSigningCounters = {
        signedOk: t.ok,
        signedBad: t.bad + t.verifierBad,
        unsigned: t.frames - t.signed + Math.max(0, rejected - t.verifierBad),
      }
      const prev = link.flushed
      if (prev && prev.signedOk === counters.signedOk && prev.signedBad === counters.signedBad && prev.unsigned === counters.unsigned) continue
      link.flushed = counters
      store.setLinkCounters(link.id, counters)
    }
  }
}

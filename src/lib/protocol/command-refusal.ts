/**
 * The honest reason a link cannot carry an outbound frame, shared by the
 * transports that refuse a send and the protocol paths that check first.
 *
 * @module protocol/command-refusal
 */

import type { Transport } from './types'

/** Text for a connected link that cannot send to the vehicle (a receive-only relay credential). */
export const RECEIVE_ONLY_REFUSAL =
  'Relay credential is receive-only: this session cannot send commands to the vehicle'

/** Why `transport` cannot command right now, or null when it can. */
export function commandRefusal(transport: Transport | null | undefined): string | null {
  if (!transport?.isConnected) return 'Not connected'
  return transport.canCommand === false ? RECEIVE_ONLY_REFUSAL : null
}

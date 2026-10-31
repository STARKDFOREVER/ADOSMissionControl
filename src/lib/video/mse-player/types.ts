/** Why a session failed, so a surface can say something specific. */
export type MsePlayerErrorCode =
  | "mse-unsupported"
  | "codec-unknown"
  | "codec-unsupported"
  | "source-buffer-rejected"
  | "relay-token-unavailable"
  | "relay-refused";

export interface MsePlayerError {
  code: MsePlayerErrorCode;
  message: string;
}

export interface MsePlayerOptions {
  /**
   * Called each time the session hits a failure. Every failure except
   * `mse-unsupported` is followed by a reconnect on the fixed cadence, so a
   * caller shows the message until the element's `playing` event says frames
   * flow again.
   *
   * These used to be bare `return`s, which is how the codec mismatch became
   * a silent black screen: the pane stayed connected, empty and quiet.
   */
  onError?: (err: MsePlayerError) => void;
  /**
   * Fetches a viewer token scoped to THIS device, called before every
   * connection attempt so a reconnect never presents an expired one.
   * A rejection is reported as `relay-token-unavailable` with the
   * rejection's message, and the dial is retried.
   *
   * The relay refuses an unauthenticated upgrade. A browser `WebSocket`
   * cannot set an `Authorization` header, so the token rides in the query
   * string.
   */
  getRelayToken?: () => Promise<string>;
}

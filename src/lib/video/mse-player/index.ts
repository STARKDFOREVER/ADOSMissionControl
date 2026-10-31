/**
 * @module MsePlayer
 * @description WebSocket to MediaSource Extensions player for cloud video streaming.
 * Connects to the configured video relay at `<relay>/ws/stream/{deviceId}` and
 * feeds fragmented MP4 data into a browser <video> element. The relay URL is
 * resolved from clientConfig with a managed default (see config/endpoints).
 *
 * The codec is read from the stream's own init segment rather than assumed;
 * see `./fmp4-codec` for why a hardcoded codec string is a silent black
 * screen rather than an error.
 *
 * @license GPL-3.0-only
 */
export { MsePlayer } from "./player";
export type { MsePlayerError, MsePlayerErrorCode, MsePlayerOptions } from "./types";

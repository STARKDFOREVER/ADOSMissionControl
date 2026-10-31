/**
 * @module FeatureTypes
 * @description Agent navigation, CAN, MAC-stability, WiFi power-save and management-link types.
 * @license GPL-3.0-only
 */

/**
 * Camera + vision navigation capability the agent advertises every
 * heartbeat when the optical flow / VIO surfaces are wired. Lets the
 * GCS render the fleet "GPS-denied" pill, the pre-arm vision row, and
 * the Vision Navigation tab without having to poll a separate
 * endpoint. All inner fields are optional except the four required
 * shape keys so future agents can add metrics additively without
 * breaking older parsers.
 *
 * `rangefinderTopology` documents which side owns the downward
 * rangefinder feeding the flow / VIO solver:
 *   - "companion" — the companion computer owns the sensor and feeds
 *     the FC the resulting RNGFND distance.
 *   - "fc"        — the FC owns the rangefinder directly.
 *   - "both"      — sensors on both sides; cross-check available.
 *   - null        — no downward rangefinder is wired.
 *
 * `recommendedCameraId` matches the camera the agent's vision pipeline
 * picked for flow / VIO ingest, or null when the operator has not yet
 * chosen one.
 */
export interface NavigationCapability {
  opticalFlowSupported: boolean;
  vioSupported: boolean;
  rangefinderTopology: "companion" | "fc" | "both" | null;
  recommendedCameraId: string | null;
  flowQuality?: number;
  flowRateHz?: number;
  flowDistanceM?: number | null;
  /** Examples: "active" | "degraded" | "lost" | "absent". Free-form so
   * a future agent can add new states without a GCS-side enum bump. */
  vioState?: string;
  vioResetCounter?: number;
  vioQuality?: number;
  /** Examples: "active" | "critical" | "terminating" | "absent".
   * Mirrors the agent-side companion supervisor state. */
  companionState?: string;
  /** Currently-selected estimator key. Mirrors the agent ``mode`` config
   * field. Values today: "off" | "optical_flow". Future phases add
   * "optical_flow_degraded" | "vio_openvins" | "vio_vins_fusion" |
   * "hybrid_of_plus_vio". Free-form so the GCS does not need a new
   * release every time the agent adds an estimator. */
  mode?: string;
  /** Estimator keys the running plugin instance can actually
   * instantiate. The mode picker only shows options in this list, so
   * an operator never sees an estimator the agent cannot run on the
   * detected hardware. */
  availableEstimators?: string[];
  /** Estimator state machine. Mirrors the BaseEstimator contract on
   * the agent side. Values: "off" | "init" | "converging" |
   * "converged" | "degraded" | "failed". */
  estimatorState?: string;
  /** Where the OF scale comes from when the active estimator is an
   * optical-flow variant. Values: "rangefinder" | "baro" | "gps" |
   * "vision" | "static" | null. Null when the estimator does not produce
   * flow (the VIO and off cases). */
  flowScaleSource?: "rangefinder" | "baro" | "gps" | "vision" | "static" | null;
  /** Number of features the VIO estimator is currently tracking. Null
   * when no VIO is active. */
  estimatorFeatureCount?: number;
  /** Estimator drift estimate in metres over a sliding window. Null
   * when not yet computable or for non-VIO estimators. */
  estimatorDriftEstimateM?: number;
  /** IMU source the estimator is reading. Values: "mavlink-raw-imu" |
   * "mavlink-scaled-imu2" | "direct-i2c" | "direct-dronecan". */
  imuSource?: string;
  /** IMU sample rate in Hz. Today this is whatever the FC publishes
   * RAW_IMU at, typically 50 to 200 Hz. A direct DroneCAN or I2C
   * path will lift this once the estimator framework wires it. */
  imuRateHz?: number;
  /** Whether camera intrinsics have been loaded. Used to gate the VIO
   * pre-arm check. */
  cameraIntrinsicsLoaded?: boolean;
  /** Estimated camera↔IMU time-sync offset in milliseconds. Yellow gate
   * at ±5 ms, red gate at ±15 ms in the GCS sensors card. */
  cameraImuSyncOffsetMs?: number;
  /** MAVLink frames the emitter failed to send since the plugin started. */
  emitErrors?: number;
  /** Last rangefinder read failure, or null while it reads cleanly. */
  rangefinderError?: string | null;
  /** Why the estimator is degraded; empty when it is not. */
  degradedReasons?: string[];
  /** FC parameters the plugin set or expects for its emit path. */
  fcParams?: string[];
}

/**
 * One CAN bus entry as the agent reports it from the persisted FC
 * parameter cache. ``port`` matches the FC's ``CAN_Pn_*`` parameter
 * suffix (1 or 2). ``driver`` is the ``CAN_Pn_DRIVER`` slot (0 means
 * the port is disabled). ``bitrate`` is the FC-configured bus speed
 * in bits per second. ``protocol`` is the ``CAN_Dn_PROTOCOL``
 * selection (1 = DroneCAN; vendor-specific otherwise). Mission
 * Control surfaces this on the drone card so an operator can see
 * the per-port CAN configuration without opening the FC parameter
 * panel. Future agent revisions may add fields (frame error counts,
 * bus utilization); the GCS treats unknown fields as a forward-
 * compatible no-op.
 */
export interface CanBusInfo {
  port: number;
  driver: number;
  bitrate: number;
  protocol: number;
}

/** One network adapter's stable-MAC verdict, reported by the agent when an
 * onboard adapter has no efuse MAC and randomizes its address each boot. */
export interface MacStabilityAdapter {
  name?: string;
  /** "vvvv:pppp" USB id. */
  vidpid?: string;
  usbPath?: string;
  /** "stable" (efuse, left alone) | "pinned" (a stable MAC was set for next
   * boot) | "candidate" (learner suspects randomization, awaiting confirm) |
   * "deferred" (can't pin yet) | "disabled" (pinning off). */
  state?: "stable" | "pinned" | "candidate" | "deferred" | "disabled";
  source?: "quirk" | "learned" | "override";
  pinnedMac?: string;
  lastSeenMac?: string;
  appliedLive?: boolean;
  linkFile?: string;
  deferredReason?: string;
}

/** Per-adapter stable-MAC pin verdicts. Absent on boards with no no-efuse
 * randomizer; lets the Network panel show the operator that the agent handled
 * the IP-churn and surface the pinned MAC for a DHCP reservation. */
export interface MacStability {
  version?: number;
  adapters: MacStabilityAdapter[];
}

/** One WiFi interface's power-save reconciler verdict, reported by the agent's
 * runtime reconciler that holds power-save OFF. Power-save adds receive latency
 * and drops throughput on a link that must stay responsive, so `powersaveOn`
 * reads false on a healthy interface; a true reading means the reconciler has
 * not yet re-asserted it back off. */
export interface WifiPowersaveInterface {
  iface: string;
  /** True when power-save is currently ON (undesired); a healthy interface
   * reads false because the reconciler holds it off. */
  powersaveOn: boolean;
  /** How many times the reconciler has had to re-assert power-save OFF on this
   * interface. A climbing count means the driver keeps flipping it back on. */
  reasserts: number;
  /** ISO-8601 timestamp of the last re-assert, or null when it has never had
   * to intervene. */
  lastReassert: string | null;
  /** Current link signal in dBm (negative), or null when unknown. */
  signalDbm: number | null;
  /** The interface's link state as the agent sees it (e.g. "connected"). */
  linkState: string;
}

/** Per-interface WiFi power-save reconciler verdicts. Absent on agents that
 * predate the reconciler, or on profiles with no managed WiFi interface. Lets
 * the Network panel prove power-save is held OFF at runtime and surface the
 * re-assert count + signal per interface. */
export interface WifiPowersave {
  interfaces: WifiPowersaveInterface[];
}

/** Operator management-link health, from the agent's management-link guardian.
 * Absent on agents that predate the guardian. A "degraded" link is up but
 * passing no traffic (gateway unreachable) — rendered distinctly from healthy. */
export interface ManagementLink {
  /** "healthy" | "degraded" (up, no data path) | "down" | "unknown". */
  state: "healthy" | "degraded" | "down" | "unknown";
  /** The interface carrying the management link (e.g. "eth0", "wlan0"). */
  iface?: string;
  transport?: "ethernet" | "wifi";
  backend?: "networkmanager" | "networkd" | "fallback";
  carrier?: boolean;
  hasLease?: boolean;
  gatewayReachable?: boolean;
  /** True when the guardian is actively walking the repair ladder. */
  repairing?: boolean;
  /** The last repair rung attempted: "reassert_reg" | "renew_dhcp" |
   * "reconnect_wifi" | "bounce_iface" | "restart_backend" | "exhausted". */
  lastRung?: string;
  lastRepairAt?: number | null;
  repairsInWindow?: number;
}

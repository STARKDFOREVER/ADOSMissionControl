/**
 * @module schemaTablesFlight
 * @description Mission, flight-log, preference and AI-usage tables.
 *
 * Shared by every deployment; composed by `schemaTables.ts`.
 *
 * @license GPL-3.0-only
 */

import { defineTable } from "convex/server";
import { v } from "convex/values";

export const flightTables = {
  // ── Command GCS tables (cmd_ prefix) ───────────────────────

  cmd_missions: defineTable({
    userId: v.string(),
    name: v.string(),
    waypoints: v.array(v.object({
      id: v.string(),
      lat: v.number(),
      lon: v.number(),
      alt: v.number(),
      speed: v.optional(v.number()),
      holdTime: v.optional(v.number()),
      command: v.optional(v.string()),
      param1: v.optional(v.number()),
      param2: v.optional(v.number()),
      param3: v.optional(v.number()),
    })),
    droneId: v.optional(v.string()),
    // Tombstone — the suite framework retired and the client no longer
    // sends or reads suiteType. Kept as v.optional for one release so
    // existing cmd_missions rows that still carry the field validate
    // cleanly. Drop after the shared production cycle finishes.
    suiteType: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  cmd_connectionPresets: defineTable({
    userId: v.string(),
    name: v.string(),
    type: v.union(v.literal("serial"), v.literal("websocket")),
    config: v.object({
      baudRate: v.optional(v.number()),
      url: v.optional(v.string()),
    }),
  }).index("by_userId", ["userId"]),

  cmd_flightLogs: defineTable({
    userId: v.string(),
    /** FlightRecord.id from the client (UUID). Stable across sync. */
    clientId: v.string(),
    droneId: v.string(),
    droneName: v.string(),
    // Tombstone — see cmd_missions.suiteType comment.
    suiteType: v.optional(v.string()),
    startTime: v.number(),
    startTimeUnknown: v.optional(v.boolean()),
    endTime: v.number(),
    duration: v.number(),
    distance: v.optional(v.number()),
    maxAlt: v.optional(v.number()),
    maxSpeed: v.optional(v.number()),
    avgSpeed: v.optional(v.number()),
    batteryUsed: v.optional(v.number()),
    batteryStartV: v.optional(v.number()),
    batteryEndV: v.optional(v.number()),
    waypointCount: v.number(),
    status: v.union(
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("aborted"),
      v.literal("emergency"),
    ),
    // Geo
    takeoffLat: v.optional(v.number()),
    takeoffLon: v.optional(v.number()),
    landingLat: v.optional(v.number()),
    landingLon: v.optional(v.number()),
    /** Downsampled track: [[lat, lon], ...]. */
    path: v.optional(v.array(v.array(v.number()))),
    // Recording linkage
    recordingId: v.optional(v.string()),
    hasTelemetry: v.optional(v.boolean()),
    // Analyzer fields
    events: v.optional(
      v.array(
        v.object({
          t: v.number(),
          type: v.string(),
          severity: v.union(v.literal("info"), v.literal("warning"), v.literal("error")),
          label: v.string(),
          data: v.optional(v.any()),
        }),
      ),
    ),
    flags: v.optional(
      v.array(
        v.object({
          type: v.string(),
          severity: v.union(v.literal("info"), v.literal("warning"), v.literal("error")),
          message: v.string(),
          suggestion: v.optional(v.string()),
        }),
      ),
    ),
    health: v.optional(
      v.object({
        avgSatellites: v.optional(v.number()),
        avgHdop: v.optional(v.number()),
        maxVibrationRms: v.optional(v.number()),
        batteryHealthPct: v.optional(v.number()),
      }),
    ),
    // User metadata
    customName: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    favorite: v.optional(v.boolean()),
    // Frozen pilot/aircraft snapshot at arm time
    pilotFirstName: v.optional(v.string()),
    pilotLastName: v.optional(v.string()),
    pilotLicenseNumber: v.optional(v.string()),
    pilotLicenseIssuer: v.optional(v.string()),
    aircraftRegistration: v.optional(v.string()),
    aircraftSerial: v.optional(v.string()),
    aircraftMtomKg: v.optional(v.number()),
    // Sign-and-lock seal: pilot signature + hash freeze the row
    pilotSignedAt: v.optional(v.number()),
    pilotSignatureHash: v.optional(v.string()),
    /** Server-kept: the signature last released by an unseal. */
    unsealedHash: v.optional(v.string()),
    /** Server-kept: digest of the sealed content that signature covered. */
    unsealedContentDigest: v.optional(v.string()),
    /** Server-kept: when the record was last unsealed. */
    unsealedAt: v.optional(v.number()),
    // Origin tracking for imported records.
    source: v.optional(
      v.union(v.literal("live"), v.literal("dataflash"), v.literal("imported"), v.literal("ulog"), v.literal("tlog")),
    ),
    sourceFilename: v.optional(v.string()),
    // Frozen loadout snapshot at arm time.
    loadout: v.optional(
      v.object({
        batteryIds: v.optional(v.array(v.string())),
        propSetId: v.optional(v.string()),
        motorSetId: v.optional(v.string()),
        escSetId: v.optional(v.string()),
        cameraId: v.optional(v.string()),
        gimbalId: v.optional(v.string()),
        payloadId: v.optional(v.string()),
        frameId: v.optional(v.string()),
        rcTxId: v.optional(v.string()),
      }),
    ),
    // Sun / moon environmental snapshot at arm time.
    sunMoon: v.optional(
      v.object({
        computedAt: v.string(),
        lat: v.number(),
        lon: v.number(),
        sunriseIso: v.optional(v.string()),
        sunsetIso: v.optional(v.string()),
        civilDawnIso: v.optional(v.string()),
        civilDuskIso: v.optional(v.string()),
        goldenHourMorningStartIso: v.optional(v.string()),
        goldenHourMorningEndIso: v.optional(v.string()),
        goldenHourEveningStartIso: v.optional(v.string()),
        goldenHourEveningEndIso: v.optional(v.string()),
        daylightPhase: v.union(
          v.literal("day"),
          v.literal("civil_twilight"),
          v.literal("nautical_twilight"),
          v.literal("astronomical_twilight"),
          v.literal("night"),
        ),
        inGoldenHour: v.boolean(),
        sunAltitudeDeg: v.number(),
        sunAzimuthDeg: v.number(),
        moonPhase: v.number(),
        moonIllumination: v.number(),
        moonPhaseLabel: v.string(),
        moonAltitudeDeg: v.number(),
        moonAzimuthDeg: v.number(),
      }),
    ),
    // METAR weather snapshot at arm time.
    weatherSnapshot: v.optional(
      v.object({
        observedAt: v.string(),
        stationIcao: v.string(),
        stationName: v.optional(v.string()),
        stationLat: v.optional(v.number()),
        stationLon: v.optional(v.number()),
        stationDistanceKm: v.optional(v.number()),
        tempC: v.optional(v.number()),
        dewPointC: v.optional(v.number()),
        windDirDeg: v.optional(v.number()),
        windKts: v.optional(v.number()),
        gustKts: v.optional(v.number()),
        visibilityMi: v.optional(v.number()),
        ceilingFtAgl: v.optional(v.number()),
        altimeterHpa: v.optional(v.number()),
        flightCategory: v.optional(
          v.union(
            v.literal("VFR"),
            v.literal("MVFR"),
            v.literal("IFR"),
            v.literal("LIFR"),
          ),
        ),
        rawMetar: v.optional(v.string()),
        error: v.optional(v.string()),
      }),
    ),
    // Mission adherence (intended vs actual).
    missionId: v.optional(v.string()),
    missionName: v.optional(v.string()),
    missionWaypoints: v.optional(
      v.array(
        v.object({
          lat: v.number(),
          lon: v.number(),
          alt: v.number(),
        }),
      ),
    ),
    adherence: v.optional(
      v.object({
        totalWaypoints: v.number(),
        waypointsReached: v.number(),
        maxCrossTrackErrorM: v.number(),
        meanCrossTrackErrorM: v.number(),
        deviationSegments: v.optional(
          v.array(
            v.object({
              startIdx: v.number(),
              endIdx: v.number(),
              maxErrorM: v.number(),
            }),
          ),
        ),
      }),
    ),
    // Geofence forensics: zones snapshot + breach segments.
    geofenceSnapshot: v.optional(
      v.object({
        enabled: v.boolean(),
        maxAltitude: v.optional(v.number()),
        minAltitude: v.optional(v.number()),
        zones: v.optional(
          v.array(
            v.object({
              id: v.string(),
              role: v.union(v.literal("inclusion"), v.literal("exclusion")),
              type: v.union(v.literal("polygon"), v.literal("circle")),
              polygonPoints: v.optional(v.array(v.array(v.number()))),
              circleCenter: v.optional(v.array(v.number())),
              circleRadius: v.optional(v.number()),
            }),
          ),
        ),
      }),
    ),
    geofenceBreaches: v.optional(
      v.array(
        v.object({
          startIdx: v.number(),
          endIdx: v.number(),
          type: v.union(
            v.literal("polygon_outside"),
            v.literal("polygon_inside"),
            v.literal("circle_outside"),
            v.literal("circle_inside"),
            v.literal("max_altitude"),
            v.literal("min_altitude"),
          ),
          zoneId: v.string(),
          maxBreachDistanceM: v.optional(v.number()),
          peakIdx: v.optional(v.number()),
        }),
      ),
    ),
    // Flight phase segmentation (takeoff / climb / cruise / etc).
    phases: v.optional(
      v.array(
        v.object({
          type: v.union(
            v.literal("pre_arm"),
            v.literal("takeoff"),
            v.literal("climb"),
            v.literal("cruise"),
            v.literal("hover"),
            v.literal("descent"),
            v.literal("land"),
            v.literal("post_disarm"),
          ),
          startMs: v.number(),
          endMs: v.number(),
          avgSpeed: v.optional(v.number()),
          maxAlt: v.optional(v.number()),
        }),
      ),
    ),
    // Wind estimation from FC telemetry.
    windEstimate: v.optional(
      v.object({
        speedMs: v.number(),
        fromDirDeg: v.number(),
        sampleCount: v.number(),
        method: v.union(v.literal("vfr_diff"), v.literal("fc_estimate")),
      }),
    ),
    // Media files linked to this flight (metadata only, blobs stay in IDB).
    media: v.optional(
      v.array(
        v.object({
          id: v.string(),
          name: v.string(),
          type: v.string(),
          size: v.number(),
          capturedAt: v.number(),
          lat: v.optional(v.number()),
          lon: v.optional(v.number()),
          alt: v.optional(v.number()),
          blobKey: v.string(),
        }),
      ),
    ),
    // Soft-delete fields.
    deleted: v.optional(v.boolean()),
    deletedAt: v.optional(v.number()),
    // Reverse-geocoded place names from takeoff / landing coords.
    takeoffPlaceName: v.optional(v.string()),
    landingPlaceName: v.optional(v.string()),
    country: v.optional(v.string()),
    region: v.optional(v.string()),
    locality: v.optional(v.string()),
    // Frozen pre-flight checklist + prearm bitmask snapshot.
    preflight: v.optional(
      v.object({
        checklistSessionId: v.optional(v.string()),
        checklistStartedAt: v.optional(v.number()),
        checklistComplete: v.optional(v.boolean()),
        checklistItems: v.optional(
          v.array(
            v.object({
              id: v.string(),
              category: v.string(),
              label: v.string(),
              status: v.union(
                v.literal("pending"),
                v.literal("pass"),
                v.literal("fail"),
                v.literal("skipped"),
              ),
              type: v.union(v.literal("auto"), v.literal("manual")),
              displayValue: v.optional(v.string()),
            }),
          ),
        ),
        sysStatusHealth: v.optional(v.number()),
        sysStatusPresent: v.optional(v.number()),
        sysStatusEnabled: v.optional(v.number()),
        prearmFailures: v.optional(v.array(v.string())),
      }),
    ),
    /** Last mutation time (client-side). Server uses this for last-write-wins conflict resolution. */
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_user_clientId", ["userId", "clientId"])
    .index("by_user_startTime", ["userId", "startTime"]),

  // Denormalized per-user flight-log totals, maintained incrementally inside
  // the cmd_flightLogs upsert/remove mutations. The History tab's stats +
  // count surfaces read this single row instead of scanning (and
  // deserializing the large path/events/media arrays of) every flight log on
  // each render. Mirrors the prior full-scan semantics exactly: every
  // persisted row (including soft-deleted rows, which the scan also summed)
  // contributes to count + the seconds/meters/batteryHours totals. A hard
  // `remove` subtracts its contribution.
  cmd_flightLogAggregates: defineTable({
    userId: v.string(),
    count: v.number(),
    totalSeconds: v.number(),
    totalMeters: v.number(),
    batteryHours: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  cmd_preferences: defineTable({
    userId: v.string(),
    preferences: v.object({
      mapTileSource: v.optional(v.string()),
      units: v.optional(v.string()),
      defaultAlt: v.optional(v.number()),
      defaultSpeed: v.optional(v.number()),
      defaultAcceptRadius: v.optional(v.number()),
      defaultFrame: v.optional(v.string()),
    }),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  cmd_ai_usage: defineTable({
    userId: v.string(),
    feature: v.string(),
    usedAt: v.number(),
  })
    .index("by_userId_feature", ["userId", "feature"])
    .index("by_usedAt", ["usedAt"]),
};

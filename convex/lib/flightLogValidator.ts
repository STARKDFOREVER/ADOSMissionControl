/**
 * @module convex/lib/flightLogValidator
 * @description Validator for one cloud-synced flight-log record, shared by the
 * `cmdFlightLogs` upsert mutation.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";

const EVENT_VALIDATOR = v.object({
  t: v.number(),
  type: v.string(),
  severity: v.union(v.literal("info"), v.literal("warning"), v.literal("error")),
  label: v.string(),
  data: v.optional(v.any()),
});

const FLAG_VALIDATOR = v.object({
  type: v.string(),
  severity: v.union(v.literal("info"), v.literal("warning"), v.literal("error")),
  message: v.string(),
  suggestion: v.optional(v.string()),
});

const HEALTH_VALIDATOR = v.object({
  avgSatellites: v.optional(v.number()),
  avgHdop: v.optional(v.number()),
  maxVibrationRms: v.optional(v.number()),
  batteryHealthPct: v.optional(v.number()),
});

export const RECORD_VALIDATOR = {
  clientId: v.string(),
  droneId: v.string(),
  droneName: v.string(),
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
  takeoffLat: v.optional(v.number()),
  takeoffLon: v.optional(v.number()),
  landingLat: v.optional(v.number()),
  landingLon: v.optional(v.number()),
  path: v.optional(v.array(v.array(v.number()))),
  recordingId: v.optional(v.string()),
  hasTelemetry: v.optional(v.boolean()),
  events: v.optional(v.array(EVENT_VALIDATOR)),
  flags: v.optional(v.array(FLAG_VALIDATOR)),
  health: v.optional(HEALTH_VALIDATOR),
  customName: v.optional(v.string()),
  notes: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  favorite: v.optional(v.boolean()),
  pilotFirstName: v.optional(v.string()),
  pilotLastName: v.optional(v.string()),
  pilotLicenseNumber: v.optional(v.string()),
  pilotLicenseIssuer: v.optional(v.string()),
  aircraftRegistration: v.optional(v.string()),
  aircraftSerial: v.optional(v.string()),
  aircraftMtomKg: v.optional(v.number()),
  pilotSignedAt: v.optional(v.number()),
  pilotSignatureHash: v.optional(v.string()),
  source: v.optional(
    v.union(v.literal("live"), v.literal("dataflash"), v.literal("imported"), v.literal("ulog"), v.literal("tlog")),
  ),
  sourceFilename: v.optional(v.string()),
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
  windEstimate: v.optional(
    v.object({
      speedMs: v.number(),
      fromDirDeg: v.number(),
      sampleCount: v.number(),
      method: v.union(v.literal("vfr_diff"), v.literal("fc_estimate")),
    }),
  ),
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
  deleted: v.optional(v.boolean()),
  deletedAt: v.optional(v.number()),
  takeoffPlaceName: v.optional(v.string()),
  landingPlaceName: v.optional(v.string()),
  country: v.optional(v.string()),
  region: v.optional(v.string()),
  locality: v.optional(v.string()),
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
  updatedAt: v.number(),
};

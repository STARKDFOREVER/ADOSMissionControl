/**
 * @license GPL-3.0-only
 *
 * The capture keys of a top-level `cameras[]` entry survive the roster
 * read → edit → write cycle, an edit can set or clear them, and the editor
 * refuses values the agent would reject.
 */

import { describe, it, expect } from "vitest";

import { coerceRoster, legsWithEdit } from "../camera-roster";
import {
  captureDraftFrom,
  captureDraftPatch,
} from "@/components/drone-detail/cameras/CameraCaptureFields";

const WIRE = {
  id: "down",
  source: "/dev/video2",
  enabled: true,
  state: "assigned",
  capture: true,
  format: "gray8",
  exposure_us: 4000,
  gain: 2,
  trigger: "hub",
  trigger_channel: 1,
  keyframe_interval: 10,
  rotation: 180,
  hflip: true,
  encoder: "software",
};

describe("camera-roster · capture keys", () => {
  it("coerces the capture keys and drops unknown enum values", () => {
    const [cam] = coerceRoster([WIRE]);
    expect(cam).toMatchObject({
      capture: true,
      format: "gray8",
      exposure_us: 4000,
      gain: 2,
      trigger: "hub",
      keyframe_interval: 10,
    });
    const [odd] = coerceRoster([{ ...WIRE, format: "mjpeg", trigger: "gpio" }]);
    expect(odd.format).toBeNull();
    expect(odd.trigger).toBeNull();
  });

  it("keeps every capture key through an unrelated edit", () => {
    const legs = legsWithEdit(coerceRoster([WIRE]), "down", { name: "Floor cam" });
    expect(legs[0]).toMatchObject({
      name: "Floor cam",
      capture: true,
      format: "gray8",
      exposure_us: 4000,
      gain: 2,
      trigger: "hub",
      trigger_channel: 1,
      keyframe_interval: 10,
      rotation: 180,
      hflip: true,
      encoder: "software",
    });
  });

  it("sets and clears capture keys from a patch", () => {
    const roster = coerceRoster([WIRE]);
    const [leg] = legsWithEdit(roster, "down", {
      capture: false,
      exposure_us: null,
      trigger: "fc",
      keyframe_interval: 0,
    });
    expect(leg.capture).toBe(false);
    // The agent merges onto the stored entry, so a clear rides as null.
    expect(leg.exposure_us).toBeNull();
    expect(leg.trigger).toBe("fc");
    expect(leg.keyframe_interval).toBe(0);
    expect(leg.gain).toBe(2);
  });

  it("omits capture keys the roster never carried", () => {
    const [leg] = legsWithEdit(coerceRoster([{ id: "eo", source: "/dev/video0", state: "assigned" }]), "eo", {});
    for (const key of ["capture", "format", "exposure_us", "gain", "trigger", "keyframe_interval"]) {
      expect(leg).not.toHaveProperty(key);
    }
  });
});

describe("CameraCaptureFields · draft → patch", () => {
  const [cam] = coerceRoster([WIRE]);

  it("an untouched draft changes nothing", () => {
    expect(captureDraftPatch(cam, captureDraftFrom(cam))).toEqual({ patch: {} });
  });

  it("reports only the changed keys, empty fields clearing to the default", () => {
    const draft = { ...captureDraftFrom(cam), exposure: "", format: "bayer_rggb8", keyframe: "30" };
    expect(captureDraftPatch(cam, draft)).toEqual({
      patch: { exposure_us: null, format: "bayer_rggb8", keyframe_interval: 30 },
    });
  });

  it("refuses values the agent rejects", () => {
    const base = captureDraftFrom(cam);
    expect(captureDraftPatch(cam, { ...base, exposure: "0" })).toEqual({ error: "exposureInvalid" });
    expect(captureDraftPatch(cam, { ...base, exposure: "12.5" })).toEqual({ error: "exposureInvalid" });
    expect(captureDraftPatch(cam, { ...base, keyframe: "31" })).toEqual({ error: "keyframeInvalid" });
    expect(captureDraftPatch(cam, { ...base, gain: "abc" })).toEqual({ error: "gainInvalid" });
  });
});

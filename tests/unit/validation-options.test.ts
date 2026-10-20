import { describe, it, expect } from 'vitest';
import { buildValidationOptions, type ValidationOptionsSnapshot } from '@/hooks/use-validation-options';

const base: ValidationOptionsSnapshot = {
  enabled: true,
  fenceType: 'polygon',
  maxAltitude: 0,
  minAltitude: 0,
  polygonPoints: [],
  circleCenter: null,
  circleRadius: 0,
  zones: [],
  rallyPoints: [],
  defaultFrame: 'relative',
  defaultSpeed: 5,
  homeCircleRadiusM: null,
  plannedHome: null,
  profile: { autopilot: 'ardupilot', vehicleClass: 'copter' },
};

describe('buildValidationOptions', () => {
  it('validates against the planned home and its ground', () => {
    const options = buildValidationOptions({ ...base, plannedHome: { lat: 12.97, lon: 77.59, groundAmsl: 412 } });
    expect(options.home).toEqual({ lat: 12.97, lon: 77.59, groundElevation: 412 });
    expect(buildValidationOptions(base).home).toBeUndefined();
  });

  it('passes the profile and default speed through', () => {
    const options = buildValidationOptions({ ...base, profile: { autopilot: 'px4', vehicleClass: 'plane' } });
    expect(options.profile).toEqual({ autopilot: 'px4', vehicleClass: 'plane' });
    expect(options.defaultSpeed).toBe(5);
    expect(buildValidationOptions({ ...base, profile: null }).profile).toBeUndefined();
  });

  it('enforces the home circle fence only while the fence is enabled', () => {
    expect(buildValidationOptions({ ...base, homeCircleRadiusM: 300 }).homeCircleRadiusM).toBe(300);
    expect(buildValidationOptions({ ...base, enabled: false, homeCircleRadiusM: 300 }).homeCircleRadiusM).toBeUndefined();
  });
});

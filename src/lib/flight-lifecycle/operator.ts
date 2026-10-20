/**
 * Operator snapshot — pilot, aircraft and loadout fields frozen into a
 * flight record at arm.
 *
 * @license GPL-3.0-only
 */

import { useOperatorProfileStore } from "@/stores/operator-profile-store";
import { useAircraftRegistryStore } from "@/stores/aircraft-registry-store";
import { useLoadoutStore } from "@/stores/loadout-store";
import type { FlightRecord, LoadoutSnapshot } from "../types";

/** The pilot, aircraft and loadout fields frozen into a record at arm. */
export function operatorSnapshot(droneId: string, droneName: string): Partial<FlightRecord> {
  const profile = useOperatorProfileStore.getState().profile;
  const aircraft = useAircraftRegistryStore.getState().getOrCreate(droneId, droneName);
  const loadout: LoadoutSnapshot | undefined = useLoadoutStore.getState().get(droneId);
  return {
    pilotFirstName: profile.pilotFirstName,
    pilotLastName: profile.pilotLastName,
    pilotLicenseNumber: profile.pilotLicenseNumber,
    pilotLicenseIssuer: profile.pilotLicenseIssuer,
    aircraftRegistration: aircraft.registrationNumber,
    aircraftSerial: aircraft.serialNumber,
    aircraftMtomKg: aircraft.mtomKg,
    loadout,
  };
}

/**
 * Mission-planning slice for the persisted settings store: the camera
 * profiles the operator added for survey and inspection patterns.
 *
 * @license GPL-3.0-only
 */

import type { SettingsSliceFactory, SettingsStoreState } from "./types";

export const planningDefaults: Partial<SettingsStoreState> = {
  customCameras: [],
};

export const createPlanningActions: SettingsSliceFactory<
  Pick<SettingsStoreState, "addCustomCamera" | "updateCustomCamera" | "removeCustomCamera">
> = (set) => ({
  addCustomCamera: (camera) =>
    set((s) => ({ customCameras: [...s.customCameras.filter((c) => c.name !== camera.name), camera] })),
  updateCustomCamera: (name, camera) =>
    set((s) => ({
      customCameras: s.customCameras
        .filter((c) => c.name === name || c.name !== camera.name)
        .map((c) => (c.name === name ? camera : c)),
    })),
  removeCustomCamera: (name) =>
    set((s) => ({ customCameras: s.customCameras.filter((c) => c.name !== name) })),
});

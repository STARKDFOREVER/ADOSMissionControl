/**
 * @module PlannedHomeLayer
 * @description The plan's planned home on the planner map: an "H" marker,
 * draggable in select mode (one undo step per drag), with the ground elevation
 * in its tooltip. Where the selected vehicle reports a home at the plan's site
 * that is more than 30 m from the planned home, a faint outlined house marks it;
 * clicking it offers "Use as planned home". Must render inside a react-leaflet
 * MapContainer.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Marker, Tooltip } from "react-leaflet";
import type { LeafletMouseEvent } from "leaflet";
import { Popover } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { plannedHomeIcon, vehicleHomeGhostIcon } from "@/components/map/home-icon";
import { useVehicleHomeOffer } from "@/hooks/use-vehicle-home-offer";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";

export function PlannedHomeLayer() {
  const t = useTranslations("planner.map");
  const plannedHome = useMissionStore((s) => s.plannedHome);
  const draggable = usePlannerStore((s) => s.activeTool === "select" && !s.homePickArmed);
  const offer = useVehicleHomeOffer();
  const ghostRef = useRef<HTMLElement | null>(null);
  const [ghostOpen, setGhostOpen] = useState(false);

  const adoptOffer = useCallback(() => {
    if (!offer) return;
    // HOME_POSITION altitude is AMSL at the vehicle's launch spot: the ground there.
    useMissionStore.getState().setPlannedHome({
      lat: offer.lat,
      lon: offer.lon,
      ...(Number.isFinite(offer.alt) ? { groundAmsl: offer.alt } : {}),
    });
    setGhostOpen(false);
  }, [offer]);

  const ground = plannedHome?.groundAmsl;
  return (
    <>
      {plannedHome && (
        <Marker
          position={[plannedHome.lat, plannedHome.lon]}
          icon={plannedHomeIcon}
          draggable={draggable}
          zIndexOffset={500}
          eventHandlers={{
            // A drop replaces the home outright; the seed samples the new ground.
            dragend: (e) => {
              const ll = e.target.getLatLng();
              useMissionStore.getState().setPlannedHome({ lat: ll.lat, lon: ll.lng });
            },
          }}
        >
          <Tooltip direction="top" offset={[0, -12]}>
            {t("plannedHome", {
              ground: ground !== undefined ? t("groundMsl", { m: Math.round(ground) }) : t("groundUnknown"),
            })}
          </Tooltip>
        </Marker>
      )}
      {offer && (
        <Marker
          position={[offer.lat, offer.lon]}
          icon={vehicleHomeGhostIcon}
          title={t("vehicleHome")}
          eventHandlers={{
            click: (e: LeafletMouseEvent) => {
              e.originalEvent.stopPropagation();
              ghostRef.current = (e.target.getElement?.() as HTMLElement | undefined) ?? null;
              setGhostOpen(true);
            },
          }}
        />
      )}
      <Popover anchorRef={ghostRef} open={ghostOpen && offer !== null} onOpenChange={setGhostOpen} ariaLabel={t("vehicleHome")} className="p-2">
        <Button size="sm" variant="secondary" onClick={adoptOffer}>
          {t("useAsPlannedHome")}
        </Button>
      </Popover>
    </>
  );
}

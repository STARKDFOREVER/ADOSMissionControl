"use client";

/**
 * @module components/fc/shared/FcSection
 * @description The bordered section shell used across the flight-controller
 * configuration panels, with an optional icon/title/description header and a
 * right-aligned `actions` slot.
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";

export interface FcSectionProps {
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  /** Right-aligned header content (a readout, a badge, a button). */
  actions?: ReactNode;
  children?: ReactNode;
}

export function FcSection({ icon, title, description, actions, children }: FcSectionProps) {
  const hasHeader = icon != null || title != null || description != null || actions != null;
  return (
    <div className="border border-border-default bg-bg-secondary p-4 space-y-3">
      {hasHeader && (
        <div className="flex items-center gap-2 mb-1">
          {icon != null && <span className="text-accent-primary">{icon}</span>}
          <div className="flex-1 min-w-0">
            {title != null && <h2 className="text-sm font-medium text-text-primary">{title}</h2>}
            {description != null && <p className="text-[10px] text-text-tertiary">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

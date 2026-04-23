import type { Vertical, VerticalId } from "./types.js";
import { medspa } from "./medspa/index.js";
import { garageDoors } from "./garage-doors/index.js";

export const VERTICALS: Record<VerticalId, Vertical> = {
  "medspa": medspa,
  "garage-doors": garageDoors,
};

export function getVertical(id: VerticalId): Vertical {
  const v = VERTICALS[id];
  if (!v) {
    throw new Error(`unknown vertical: ${id}`);
  }
  return v;
}

export type { Vertical, VerticalId, ToolId, BookingAdapterId } from "./types.js";

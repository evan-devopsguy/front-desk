import type { Vertical } from "../types.js";

export const escalation: Vertical["escalation"] = {
  alwaysEscalateCategories: ["emergency"],
  escalationTool: "notify_owner",
  slaMinutesByUrgency: { emergency: 15, complaint: 240, fyi: 1440 },
};

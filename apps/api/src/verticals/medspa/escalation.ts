import type { Vertical } from "../types.js";

export const escalation: Vertical["escalation"] = {
  alwaysEscalateCategories: ["clinical"],
  escalationTool: "escalate_to_human",
};

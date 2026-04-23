import type { Vertical } from "../types.js";
import { system, classifier as classifierPrompt } from "./prompts.js";
import { classifier } from "./classifier.js";
import { tools } from "./tools.js";
import { escalation } from "./escalation.js";
import { compliance } from "./compliance.js";

export const medspa: Vertical = {
  id: "medspa",
  prompts: { system, classifier: classifierPrompt },
  contactRole: "patient",
  classifierFallback: "clinical",
  classifier,
  escalation,
  tools,
  bookingAdapters: ["mock", "boulevard", "vagaro"],
  compliance,
};

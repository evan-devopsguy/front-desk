import type { Vertical } from "../types.js";
import { system, classifier as classifierPrompt } from "./prompts.js";
import { classifier } from "./classifier.js";
import { tools } from "./tools.js";
import { escalation } from "./escalation.js";
import { compliance } from "./compliance.js";

export const garageDoors: Vertical = {
  id: "garage-doors",
  prompts: { system, classifier: classifierPrompt },
  contactRole: "contact",
  classifierFallback: "faq",
  classifier,
  escalation,
  tools,
  bookingAdapters: ["mock", "google-calendar"],
  compliance,
};

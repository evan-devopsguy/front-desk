import type { Intent } from "@medspa/shared";

export const classifier: { categories: ReadonlyArray<Intent> } = {
  categories: ["faq", "booking", "clinical", "complaint", "spam"],
};

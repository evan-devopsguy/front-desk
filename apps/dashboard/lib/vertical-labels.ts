export interface VerticalLabels {
  contactLabel: "Customer" | "Patient";
  categories: readonly string[];
}

export function labelsFor(vertical: string): VerticalLabels {
  if (vertical === "garage-doors") {
    return {
      contactLabel: "Customer",
      categories: ["faq", "booking", "emergency", "complaint", "spam"],
    };
  }
  return {
    contactLabel: "Patient",
    categories: ["faq", "booking", "clinical", "complaint", "spam"],
  };
}

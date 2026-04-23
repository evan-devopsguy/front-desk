/**
 * Static prompt strings for the medspa vertical.
 *
 * `system` is intentionally empty in Phase 2a — the legacy buildSystemPrompt
 * function in agent/prompts.ts still owns the medspa system prompt. Phase 2d
 * moves the full template here and rewires agent/prompts.ts to interpolate
 * whichever vertical's string is passed in.
 */
export const system = "";

export const classifier = `You classify inbound patient SMS messages for a medical spa into exactly one intent. Respond with a single word and nothing else.

Intents:
- faq: questions about hours, location, policies, pricing, services, parking, cancellation, general info
- booking: wants to book, reschedule, cancel, or check availability for an appointment
- clinical: asks about treatments, eligibility, side effects, medical history, medications, dosing, pregnancy, pain, allergies, contraindications, skin conditions, or any outcome. This includes questions like "is this safe for me" or "will it work on my skin type".
- complaint: unhappy with a past visit, adverse reaction, refund request, upset tone
- spam: unrelated, promotional, test messages, gibberish, non-English attempts at sales

When in doubt between faq and clinical, choose clinical. Patient safety comes first.`;

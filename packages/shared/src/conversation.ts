import { z } from "zod";

export const channelSchema = z.enum(["sms", "voice", "ig"]);
export type Channel = z.infer<typeof channelSchema>;

export const conversationStatusSchema = z.enum([
  "active",
  "booked",
  "escalated",
  "abandoned",
]);
export type ConversationStatus = z.infer<typeof conversationStatusSchema>;

export const messageRoleSchema = z.enum([
  "patient",
  "contact",
  "assistant",
  "system",
]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const conversationSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  channel: channelSchema,
  contactPhoneHash: z.string().nullable(),
  status: conversationStatusSchema,
  createdAt: z.string().datetime(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const messageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: messageRoleSchema,
  content: z.string(),
  toolCalls: z.unknown().nullable(),
  createdAt: z.string().datetime(),
});
export type Message = z.infer<typeof messageSchema>;

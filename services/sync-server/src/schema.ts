import { z } from "zod";

const envelopeSchema = z.object({
  version: z.literal(1),
  alg: z.literal("aes-256-gcm"),
  nonce: z.string().min(8),
  ciphertext: z.string().min(8)
});

export const syncEventSchema = z.object({
  eventId: z.string().min(1),
  sourceDeviceId: z.string().min(1),
  sourceDeviceType: z.enum(["desktop", "mobile", "browser"]),
  startTs: z.string().datetime(),
  endTs: z.string().datetime(),
  envelope: envelopeSchema
});

export const pushSchema = z.object({
  userId: z.string().min(1),
  deviceId: z.string().min(1),
  deviceType: z.enum(["desktop", "mobile", "browser"]),
  events: z.array(syncEventSchema).max(10_000)
});

export const pullQuerySchema = z.object({
  userId: z.string().min(1),
  deviceId: z.string().min(1),
  deviceType: z.enum(["desktop", "mobile", "browser"]).default("desktop"),
  sinceCursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().positive().max(5000).default(500)
});

export const statusQuerySchema = z.object({
  userId: z.string().min(1)
});

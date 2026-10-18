// BIG PICTURE
// The one definition of a valid ?status= value, shared by the home page and
// GET /api/matters so the two cannot drift apart.
import { z } from "zod";

export const MATTER_STATUSES = ["open", "pending", "closed"] as const;

export const StatusSchema = z.enum(MATTER_STATUSES).optional();

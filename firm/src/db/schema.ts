import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    username: text("username").unique().notNull(),
    passwordHash: text("password_hash").notNull(),
    email: text("email").unique().notNull(),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "users_role_check",
      sql`${t.role} IN ('client', 'attorney', 'paralegal', 'admin')`,
    ),
  ],
);

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .unique()
    .references(() => users.id, { onDelete: "set null" }),
  fullName: text("full_name").notNull(),
  dob: date("dob"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const matters = pgTable(
  "matters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    // Who created the matter. The RLS select policy lets a creator read the row before
    // their matter_members row exists, which `INSERT ... RETURNING` needs. The app role
    // cannot UPDATE this column (column grants in 0003_rls_policies.sql), otherwise a
    // member could rewrite it and hand someone else read access.
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    status: text("status").notNull().default("open"),
    type: text("type").notNull(),
    openedAt: date("opened_at"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("matters_client_id_idx").on(t.clientId),
    index("matters_created_by_idx").on(t.createdBy),
    check(
      "matters_status_check",
      sql`${t.status} IN ('open', 'pending', 'closed')`,
    ),
    check(
      "matters_type_check",
      sql`${t.type} IN ('medicaid', 'will', 'trust', 'guardianship')`,
    ),
  ],
);

// The permission table: a user can reach a matter (and its documents) only through a
// row here. The RLS policies on matters and documents are written in terms of it.
export const matterMembers = pgTable(
  "matter_members",
  {
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.matterId, t.userId] }),
    index("matter_members_user_id_idx").on(t.userId),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matterId: uuid("matter_id")
      .notNull()
      .references(() => matters.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("documents_matter_id_idx").on(t.matterId)],
);

export type Matter = typeof matters.$inferSelect;
export type NewMatter = typeof matters.$inferInsert;

import { pgTable, uniqueIndex, foreignKey, unique, pgPolicy, check, uuid, text, timestamp, boolean, integer, date, index, smallint, jsonb, time } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const contacts = pgTable("contacts", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	firstName: text("first_name"),
	lastName: text("last_name"),
	emailNorm: text("email_norm"),
	phoneE164: text("phone_e164"),
	city: text(),
	state: text(),
	timezone: text(),
	smsConsentAt: timestamp("sms_consent_at", { withTimezone: true, mode: 'string' }),
	smsConsentText: text("sms_consent_text"),
	smsConsentSource: text("sms_consent_source"),
	emailUnsubscribedAt: timestamp("email_unsubscribed_at", { withTimezone: true, mode: 'string' }),
	doNotContact: boolean("do_not_contact").default(false).notNull(),
	needsMergeReview: boolean("needs_merge_review").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("contacts_email_uniq").using("btree", table.workspaceId.asc().nullsLast().op("text_ops"), table.emailNorm.asc().nullsLast().op("uuid_ops")).where(sql`(email_norm IS NOT NULL)`),
	uniqueIndex("contacts_phone_uniq").using("btree", table.workspaceId.asc().nullsLast().op("uuid_ops"), table.phoneE164.asc().nullsLast().op("uuid_ops")).where(sql`(phone_e164 IS NOT NULL)`),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "contacts_workspace_id_fkey"
		}).onDelete("cascade"),
	unique("contacts_workspace_id_id_key").on(table.id, table.workspaceId),
	pgPolicy("member_access", { as: "permissive", for: "all", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`, withCheck: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`  }),
	check("contacts_email_norm_check", sql`email_norm = lower(email_norm)`),
	check("contacts_phone_e164_check", sql`phone_e164 ~ '^\+[1-9][0-9]{6,14}$'::text`),
	check("contacts_check", sql`(email_norm IS NOT NULL) OR (phone_e164 IS NOT NULL)`),
	check("contacts_check1", sql`(sms_consent_at IS NULL) OR (sms_consent_text IS NOT NULL)`),
]);

export const pipelineStages = pgTable("pipeline_stages", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	name: text().notNull(),
	position: integer().notNull(),
	kind: text().notNull(),
	isDefault: boolean("is_default").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("pipeline_stages_one_default").using("btree", table.workspaceId.asc().nullsLast().op("uuid_ops")).where(sql`is_default`),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "pipeline_stages_workspace_id_fkey"
		}).onDelete("cascade"),
	unique("pipeline_stages_workspace_id_id_key").on(table.id, table.workspaceId),
	unique("pipeline_stages_workspace_id_position_key").on(table.workspaceId, table.position),
	pgPolicy("member_access", { as: "permissive", for: "all", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`, withCheck: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`  }),
	check("pipeline_stages_kind_check", sql`kind = ANY (ARRAY['open'::text, 'won'::text, 'lost'::text])`),
]);

export const litters = pgTable("litters", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	name: text().notNull(),
	isGeneral: boolean("is_general").default(false).notNull(),
	sire: text(),
	dam: text(),
	expectedDate: date("expected_date"),
	bornDate: date("born_date"),
	expectedCount: integer("expected_count"),
	status: text().default('planned').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("litters_one_general").using("btree", table.workspaceId.asc().nullsLast().op("uuid_ops")).where(sql`is_general`),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "litters_workspace_id_fkey"
		}).onDelete("cascade"),
	unique("litters_workspace_id_id_key").on(table.id, table.workspaceId),
	pgPolicy("member_access", { as: "permissive", for: "all", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`, withCheck: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`  }),
	check("litters_expected_count_check", sql`expected_count >= 0`),
	check("litters_status_check", sql`status = ANY (ARRAY['planned'::text, 'confirmed'::text, 'born'::text, 'closed'::text])`),
]);

export const leads = pgTable("leads", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	contactId: uuid("contact_id").notNull(),
	stageId: uuid("stage_id").notNull(),
	litterId: uuid("litter_id"),
	source: text().notNull(),
	rating: smallint(),
	tags: text().array().default([""]).notNull(),
	assignedUserId: uuid("assigned_user_id"),
	lastContactedAt: timestamp("last_contacted_at", { withTimezone: true, mode: 'string' }),
	nextTaskDueAt: timestamp("next_task_due_at", { withTimezone: true, mode: 'string' }),
	closedReason: text("closed_reason"),
	closedAt: timestamp("closed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("leads_contact_idx").using("btree", table.workspaceId.asc().nullsLast().op("uuid_ops"), table.contactId.asc().nullsLast().op("uuid_ops")),
	index("leads_tags_idx").using("gin", table.tags.asc().nullsLast().op("array_ops")),
	index("leads_workspace_stage_idx").using("btree", table.workspaceId.asc().nullsLast().op("uuid_ops"), table.stageId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.assignedUserId],
			foreignColumns: [users.id],
			name: "leads_assigned_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "leads_workspace_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId, table.contactId],
			foreignColumns: [contacts.id, contacts.workspaceId],
			name: "leads_workspace_id_contact_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId, table.stageId],
			foreignColumns: [pipelineStages.id, pipelineStages.workspaceId],
			name: "leads_workspace_id_stage_id_fkey"
		}),
	foreignKey({
			columns: [table.workspaceId, table.litterId],
			foreignColumns: [litters.id, litters.workspaceId],
			name: "leads_workspace_id_litter_id_fkey"
		}),
	unique("leads_workspace_id_id_key").on(table.id, table.workspaceId),
	pgPolicy("member_access", { as: "permissive", for: "all", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`, withCheck: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`  }),
	check("leads_source_check", sql`source = ANY (ARRAY['form'::text, 'embed'::text, 'email'::text, 'facebook'::text, 'instagram'::text, 'text'::text, 'call'::text, 'show'::text, 'referral'::text, 'import'::text, 'other'::text])`),
	check("leads_rating_check", sql`(rating >= 1) AND (rating <= 5)`),
]);

export const forms = pgTable("forms", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	kind: text().notNull(),
	title: text().notNull(),
	fields: jsonb().default([]).notNull(),
	successMessage: text("success_message"),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "forms_workspace_id_fkey"
		}).onDelete("cascade"),
	unique("forms_workspace_id_id_key").on(table.id, table.workspaceId),
	pgPolicy("member_access", { as: "permissive", for: "all", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`, withCheck: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`  }),
	check("forms_kind_check", sql`kind = ANY (ARRAY['inquiry'::text, 'application'::text])`),
	check("forms_fields_check", sql`jsonb_typeof(fields) = 'array'::text`),
]);

export const formSubmissions = pgTable("form_submissions", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	formId: uuid("form_id").notNull(),
	leadId: uuid("lead_id"),
	answers: jsonb().default({}).notNull(),
	ipHash: text("ip_hash"),
	userAgent: text("user_agent"),
	submittedAt: timestamp("submitted_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("form_submissions_lead_idx").using("btree", table.workspaceId.asc().nullsLast().op("uuid_ops"), table.leadId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "form_submissions_workspace_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId, table.formId],
			foreignColumns: [forms.id, forms.workspaceId],
			name: "form_submissions_workspace_id_form_id_fkey"
		}),
	foreignKey({
			columns: [table.workspaceId, table.leadId],
			foreignColumns: [leads.id, leads.workspaceId],
			name: "form_submissions_workspace_id_lead_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("member_access", { as: "permissive", for: "all", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`, withCheck: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`  }),
]);

export const waitlistEntries = pgTable("waitlist_entries", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	leadId: uuid("lead_id").notNull(),
	litterId: uuid("litter_id").notNull(),
	position: integer(),
	sexPref: text("sex_pref"),
	colorPref: text("color_pref"),
	status: text().default('active').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "waitlist_entries_workspace_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId, table.leadId],
			foreignColumns: [leads.id, leads.workspaceId],
			name: "waitlist_entries_workspace_id_lead_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId, table.litterId],
			foreignColumns: [litters.id, litters.workspaceId],
			name: "waitlist_entries_workspace_id_litter_id_fkey"
		}),
	unique("waitlist_entries_workspace_id_id_key").on(table.id, table.workspaceId),
	unique("waitlist_entries_litter_id_position_key").on(table.litterId, table.position),
	pgPolicy("member_access", { as: "permissive", for: "all", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`, withCheck: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`  }),
	check("waitlist_entries_position_check", sql`"position" > 0`),
	check("waitlist_entries_status_check", sql`status = ANY (ARRAY['active'::text, 'matched'::text, 'released'::text])`),
	check("waitlist_entries_check", sql`(status = 'active'::text) = ("position" IS NOT NULL)`),
]);

export const templates = pgTable("templates", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	channel: text().notNull(),
	name: text().notNull(),
	subject: text(),
	body: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "templates_workspace_id_fkey"
		}).onDelete("cascade"),
	unique("templates_workspace_id_id_key").on(table.id, table.workspaceId),
	pgPolicy("member_access", { as: "permissive", for: "all", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`, withCheck: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`  }),
	check("templates_channel_check", sql`channel = ANY (ARRAY['email'::text, 'sms'::text])`),
	check("templates_check", sql`(channel = 'sms'::text) OR (subject IS NOT NULL)`),
]);

export const payments = pgTable("payments", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	leadId: uuid("lead_id"),
	kind: text().notNull(),
	amountCents: integer("amount_cents").notNull(),
	method: text().notNull(),
	stripeSessionId: text("stripe_session_id"),
	status: text().default('pending').notNull(),
	termsSnapshot: text("terms_snapshot"),
	note: text(),
	recordedBy: uuid("recorded_by"),
	paidAt: timestamp("paid_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("payments_lead_idx").using("btree", table.workspaceId.asc().nullsLast().op("uuid_ops"), table.leadId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "payments_workspace_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.recordedBy],
			foreignColumns: [users.id],
			name: "payments_recorded_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.workspaceId, table.leadId],
			foreignColumns: [leads.id, leads.workspaceId],
			name: "payments_workspace_id_lead_id_fkey"
		}).onDelete("set null"),
	unique("payments_stripe_session_id_key").on(table.stripeSessionId),
	pgPolicy("member_access", { as: "permissive", for: "all", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`, withCheck: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`  }),
	check("payments_kind_check", sql`kind = ANY (ARRAY['deposit'::text, 'balance'::text, 'other'::text])`),
	check("payments_amount_cents_check", sql`amount_cents > 0`),
	check("payments_method_check", sql`method = ANY (ARRAY['stripe'::text, 'zelle'::text, 'cash'::text, 'other'::text])`),
	check("payments_status_check", sql`status = ANY (ARRAY['pending'::text, 'paid'::text, 'refunded'::text])`),
	check("payments_check", sql`(status <> 'paid'::text) OR (paid_at IS NOT NULL)`),
]);

export const messages = pgTable("messages", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	leadId: uuid("lead_id").notNull(),
	channel: text().notNull(),
	direction: text().notNull(),
	templateId: uuid("template_id"),
	subject: text(),
	body: text().notNull(),
	providerId: text("provider_id"),
	status: text().notNull(),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	readAt: timestamp("read_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("messages_lead_idx").using("btree", table.workspaceId.asc().nullsLast().op("timestamptz_ops"), table.leadId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("messages_provider_uniq").using("btree", table.channel.asc().nullsLast().op("text_ops"), table.providerId.asc().nullsLast().op("text_ops")).where(sql`(provider_id IS NOT NULL)`),
	index("messages_unread_idx").using("btree", table.workspaceId.asc().nullsLast().op("uuid_ops")).where(sql`((direction = 'in'::text) AND (read_at IS NULL))`),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "messages_workspace_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId, table.leadId],
			foreignColumns: [leads.id, leads.workspaceId],
			name: "messages_workspace_id_lead_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId, table.templateId],
			foreignColumns: [templates.id, templates.workspaceId],
			name: "messages_workspace_id_template_id_fkey"
		}).onDelete("set null"),
	pgPolicy("member_access", { as: "permissive", for: "all", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`, withCheck: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`  }),
	check("messages_channel_check", sql`channel = ANY (ARRAY['email'::text, 'sms'::text])`),
	check("messages_direction_check", sql`direction = ANY (ARRAY['out'::text, 'in'::text])`),
	check("messages_status_check", sql`status = ANY (ARRAY['queued'::text, 'sent'::text, 'delivered'::text, 'failed'::text, 'received'::text])`),
	check("messages_check", sql`(direction = 'in'::text) OR (read_at IS NULL)`),
]);

export const activities = pgTable("activities", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	leadId: uuid("lead_id").notNull(),
	type: text().notNull(),
	payload: jsonb().default({}).notNull(),
	actorUserId: uuid("actor_user_id"),
	dueAt: timestamp("due_at", { withTimezone: true, mode: 'string' }),
	doneAt: timestamp("done_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("activities_lead_idx").using("btree", table.workspaceId.asc().nullsLast().op("timestamptz_ops"), table.leadId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	index("activities_open_tasks_idx").using("btree", table.workspaceId.asc().nullsLast().op("timestamptz_ops"), table.dueAt.asc().nullsLast().op("uuid_ops")).where(sql`((type = 'task'::text) AND (done_at IS NULL))`),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "activities_workspace_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actorUserId],
			foreignColumns: [users.id],
			name: "activities_actor_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.workspaceId, table.leadId],
			foreignColumns: [leads.id, leads.workspaceId],
			name: "activities_workspace_id_lead_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("member_access", { as: "permissive", for: "all", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`, withCheck: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`  }),
	check("activities_type_check", sql`type = ANY (ARRAY['note'::text, 'stage_change'::text, 'task'::text, 'call_logged'::text, 'form'::text, 'payment'::text, 'system'::text])`),
	check("activities_check", sql`(type = 'task'::text) OR (due_at IS NULL)`),
]);

export const sequences = pgTable("sequences", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	name: text().notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "sequences_workspace_id_fkey"
		}).onDelete("cascade"),
	unique("sequences_workspace_id_id_key").on(table.id, table.workspaceId),
	pgPolicy("member_access", { as: "permissive", for: "all", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`, withCheck: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`  }),
]);

export const sequenceSteps = pgTable("sequence_steps", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	sequenceId: uuid("sequence_id").notNull(),
	stepNumber: integer("step_number").notNull(),
	delayHours: integer("delay_hours").notNull(),
	templateId: uuid("template_id").notNull(),
	stopConditions: jsonb("stop_conditions").default(["inbound_reply","stage_change","manual_stop"]).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "sequence_steps_workspace_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId, table.sequenceId],
			foreignColumns: [sequences.id, sequences.workspaceId],
			name: "sequence_steps_workspace_id_sequence_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId, table.templateId],
			foreignColumns: [templates.id, templates.workspaceId],
			name: "sequence_steps_workspace_id_template_id_fkey"
		}),
	unique("sequence_steps_sequence_id_step_number_key").on(table.sequenceId, table.stepNumber),
	pgPolicy("member_access", { as: "permissive", for: "all", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`, withCheck: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`  }),
	check("sequence_steps_step_number_check", sql`step_number > 0`),
	check("sequence_steps_delay_hours_check", sql`delay_hours >= 0`),
]);

export const sequenceEnrollments = pgTable("sequence_enrollments", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	leadId: uuid("lead_id").notNull(),
	sequenceId: uuid("sequence_id").notNull(),
	nextStep: integer("next_step").default(1).notNull(),
	nextRunAt: timestamp("next_run_at", { withTimezone: true, mode: 'string' }),
	status: text().default('active').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("sequence_enrollments_due_idx").using("btree", table.nextRunAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'active'::text)`),
	uniqueIndex("sequence_enrollments_one_active").using("btree", table.leadId.asc().nullsLast().op("uuid_ops"), table.sequenceId.asc().nullsLast().op("uuid_ops")).where(sql`(status = 'active'::text)`),
	foreignKey({
			columns: [table.workspaceId, table.leadId],
			foreignColumns: [leads.id, leads.workspaceId],
			name: "sequence_enrollments_workspace_id_lead_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId, table.sequenceId],
			foreignColumns: [sequences.id, sequences.workspaceId],
			name: "sequence_enrollments_workspace_id_sequence_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "sequence_enrollments_workspace_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("member_access", { as: "permissive", for: "all", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`, withCheck: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))`  }),
	check("sequence_enrollments_status_check", sql`status = ANY (ARRAY['active'::text, 'completed'::text, 'stopped'::text])`),
]);

export const workspaces = pgTable("workspaces", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	name: text().notNull(),
	slug: text().notNull(),
	businessType: text("business_type").notNull(),
	logoUrl: text("logo_url"),
	brandColor: text("brand_color"),
	timezone: text().default('America/Chicago').notNull(),
	digestTime: time("digest_time").default('07:00:00').notNull(),
	smsEnabled: boolean("sms_enabled").default(false).notNull(),
	stripeAccountId: text("stripe_account_id"),
	depositAmountCents: integer("deposit_amount_cents"),
	depositTerms: text("deposit_terms"),
	physicalAddress: text("physical_address"),
	smsNumberE164: text("sms_number_e164"),
	twilioMessagingServiceSid: text("twilio_messaging_service_sid"),
	sendingDomain: text("sending_domain"),
	sendingDomainVerifiedAt: timestamp("sending_domain_verified_at", { withTimezone: true, mode: 'string' }),
	faq: text(),
	billingStatus: text("billing_status").default('active').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("workspaces_slug_key").on(table.slug),
	pgPolicy("member_read", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))` }),
	pgPolicy("owner_update", { as: "permissive", for: "update", to: ["authenticated"] }),
	check("workspaces_name_check", sql`(length(name) >= 1) AND (length(name) <= 120)`),
	check("workspaces_slug_check", sql`(slug ~ '^[a-z0-9](-?[a-z0-9])*$'::text) AND ((length(slug) >= 3) AND (length(slug) <= 40))`),
	check("workspaces_business_type_check", sql`business_type = ANY (ARRAY['breeder'::text, 'service'::text])`),
	check("workspaces_brand_color_check", sql`brand_color ~ '^#[0-9a-fA-F]{6}$'::text`),
	check("workspaces_deposit_amount_cents_check", sql`deposit_amount_cents >= 0`),
	check("workspaces_sms_number_e164_check", sql`sms_number_e164 ~ '^\+[1-9][0-9]{6,14}$'::text`),
	check("workspaces_billing_status_check", sql`billing_status = ANY (ARRAY['active'::text, 'past_due'::text, 'read_only'::text])`),
]);

export const users = pgTable("users", {
	id: uuid().primaryKey().notNull(),
	email: text().notNull(),
	name: text(),
	phone: text(),
	isPlatformAdmin: boolean("is_platform_admin").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.id],
			foreignColumns: [table.id],
			name: "users_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("self_or_teammate_read", { as: "permissive", for: "select", to: ["authenticated"], using: sql`((id = ( SELECT auth.uid() AS uid)) OR (id IN ( SELECT m.user_id
   FROM memberships m
  WHERE (m.workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids)))))` }),
	pgPolicy("self_update", { as: "permissive", for: "update", to: ["authenticated"] }),
]);

export const memberships = pgTable("memberships", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	role: text().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("memberships_workspace_idx").using("btree", table.workspaceId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "memberships_user_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "memberships_workspace_id_fkey"
		}).onDelete("cascade"),
	unique("memberships_user_id_workspace_id_key").on(table.userId, table.workspaceId),
	pgPolicy("member_read", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))` }),
	pgPolicy("owner_insert", { as: "permissive", for: "insert", to: ["authenticated"] }),
	pgPolicy("owner_update", { as: "permissive", for: "update", to: ["authenticated"] }),
	pgPolicy("owner_delete", { as: "permissive", for: "delete", to: ["authenticated"] }),
	check("memberships_role_check", sql`role = ANY (ARRAY['owner'::text, 'staff'::text, 'support'::text])`),
	check("memberships_check", sql`(role = 'support'::text) = (expires_at IS NOT NULL)`),
]);

export const waitlistEvents = pgTable("waitlist_events", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	workspaceId: uuid("workspace_id").notNull(),
	entryId: uuid("entry_id").notNull(),
	fromPosition: integer("from_position"),
	toPosition: integer("to_position"),
	actorUserId: uuid("actor_user_id"),
	reason: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("waitlist_events_entry_idx").using("btree", table.workspaceId.asc().nullsLast().op("uuid_ops"), table.entryId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "waitlist_events_workspace_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actorUserId],
			foreignColumns: [users.id],
			name: "waitlist_events_actor_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.workspaceId, table.entryId],
			foreignColumns: [waitlistEntries.id, waitlistEntries.workspaceId],
			name: "waitlist_events_workspace_id_entry_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("member_read", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_workspace_ids() AS my_workspace_ids))` }),
	pgPolicy("member_append", { as: "permissive", for: "insert", to: ["authenticated"] }),
	check("waitlist_events_check", sql`(from_position IS NULL) OR (to_position IS NULL) OR (length(TRIM(BOTH FROM reason)) > 0)`),
]);

export const auditLog = pgTable("audit_log", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	workspaceId: uuid("workspace_id"),
	actorUserId: uuid("actor_user_id"),
	action: text().notNull(),
	details: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("audit_log_workspace_idx").using("btree", table.workspaceId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.workspaceId],
			foreignColumns: [workspaces.id],
			name: "audit_log_workspace_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.actorUserId],
			foreignColumns: [users.id],
			name: "audit_log_actor_user_id_fkey"
		}).onDelete("set null"),
	pgPolicy("owner_read", { as: "permissive", for: "select", to: ["authenticated"], using: sql`(workspace_id IN ( SELECT app.my_admin_workspace_ids() AS my_admin_workspace_ids))` }),
]);

export const webhookEvents = pgTable("webhook_events", {
	id: uuid().default(sql`app.uuid_v7()`).primaryKey().notNull(),
	provider: text().notNull(),
	eventId: text("event_id").notNull(),
	payload: jsonb(),
	receivedAt: timestamp("received_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	processedAt: timestamp("processed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	unique("webhook_events_provider_event_id_key").on(table.provider, table.eventId),
	check("webhook_events_provider_check", sql`provider = ANY (ARRAY['stripe'::text, 'twilio'::text, 'email'::text])`),
]);

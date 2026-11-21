import { pgTable, pgEnum, uuid, text, timestamp, integer, boolean, serial, index, jsonb } from "drizzle-orm/pg-core";

export const role = pgEnum("Role", [
  "USER",
  "STUDENT",
  "ADMIN",
  "REGISTRAR",
  "DEAN",
  "LIBRARY",
  "ACCOUNTING",
  "SAO",
  "INSTRUCTOR",
  "GUIDANCE",
  "CLINIC",
]);

export const tokenType = pgEnum("TokenType", ["REFRESH", "EMAIL_VERIFY"]);

export const users = pgTable("user", {
  id: uuid().defaultRandom().primaryKey(),
  email: text().unique(),
  password: text().notNull(),
  name: text().notNull(),
  role: role().default("STUDENT").notNull(),
  studentNumber: text("student_number").unique(),
  section: text(),
  mustChangePassword: boolean("must_change_password").default(false).notNull(),
  course: text(),
  yearLevel: integer("year_level"),
  department: text(),
  avatarUrl: text("avatar_url"),
  phone: text(),
  emailVerified: timestamp("email_verified", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull().$onUpdate(() => new Date().toISOString()),
});

export const recipes = pgTable("recipe", {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  cuisine: text().notNull(),
  mealType: text().array().notNull(),
  difficulty: text().notNull(),
  cookTimeMinutes: integer().notNull(),
  tags: text().array().notNull(),
  image: text().notNull(),
  ingredients: text().array().notNull(),
  instructions: text().array().notNull(),
  userId: uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
}, (table) => [index("recipe_owner_idx").on(table.userId)]);

export const tokens = pgTable("token", {
  id: uuid().defaultRandom().primaryKey(),
  type: tokenType().notNull(),
  token: text().unique().notNull(),
  expiresAt: timestamp({ withTimezone: true, mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "string" }),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  userId: uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
}, (table) => [index("token_owner_type_idx").on(table.userId, table.type)]);

/** Reusable digital signatures are private to the staff account that saved them. */
export const staffSignatures = pgTable("staff_signature", {
  id: uuid().defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  label: text().notNull(),
  imageBase64: text("image_base64").notNull(),
  method: text().notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [index("staff_signature_owner_idx").on(table.userId, table.createdAt)]);

// ─── Student Profile ─────────────────────────────────────────────────────────

export const studentProfiles = pgTable("student_profile", {
  id: uuid().defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  phone: text(),
  alternateContact: text("alternate_contact"),
  street: text(),
  barangay: text(),
  city: text(),
  province: text(),
  gender: text(),
  dateOfBirth: text("date_of_birth"),
  placeOfBirth: text("place_of_birth"),
  civilStatus: text("civil_status"),
  religion: text(),
  nationality: text(),
  motherName: text("mother_name"),
  fatherName: text("father_name"),
  guardianName: text("guardian_name"),
  guardianContact: text("guardian_contact"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull().$onUpdate(() => new Date().toISOString()),
});

// ─── Service Requests ────────────────────────────────────────────────────────

export const services = pgTable("service", {
  id: serial().primaryKey(),
  code: text().unique().notNull(),
  name: text().notNull(),
  description: text().default(""),
  fee: integer().default(0).notNull(),
  active: boolean().default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const purposes = pgTable("purpose", {
  id: serial().primaryKey(),
  label: text().notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
});

export const serviceRequests = pgTable("service_request", {
  id: uuid().defaultRandom().primaryKey(),
  referenceNumber: text("reference_number").unique().notNull(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  serviceId: integer("service_id").notNull().references(() => services.id),
  copies: integer().default(1).notNull(),
  purpose: text(),
  notes: text(),
  attachmentName: text("attachment_name"),
  attachmentType: text("attachment_type"),
  attachmentSize: integer("attachment_size"),
  attachmentData: text("attachment_data"),
  status: text().default("submitted").notNull(),
  remarks: text(),
  lastUpdatedById: uuid("last_updated_by_id").references(() => users.id, { onDelete: "set null" }),
  lastUpdatedByRole: text("last_updated_by_role"),
  submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  index("sr_user_idx").on(table.userId),
  index("sr_status_idx").on(table.status),
  index("sr_submitted_idx").on(table.submittedAt),
]);

/** One unfinished request per student, replaced every time they save. */
export const serviceRequestDrafts = pgTable("service_request_draft", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  serviceId: integer("service_id"),
  copies: integer().default(1).notNull(),
  purpose: text(),
  notes: text(),
  attachmentName: text("attachment_name"),
  attachmentType: text("attachment_type"),
  attachmentSize: integer("attachment_size"),
  attachmentData: text("attachment_data"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull().$onUpdate(() => new Date().toISOString()),
});

/** One row per office action, used by the Request Status timeline. */
export const serviceRequestHistory = pgTable("service_request_history", {
  id: uuid().defaultRandom().primaryKey(),
  requestId: uuid("request_id").notNull().references(() => serviceRequests.id, { onDelete: "cascade" }),
  oldStatus: text("old_status"),
  newStatus: text("new_status").notNull(),
  changedById: uuid("changed_by_id").references(() => users.id, { onDelete: "set null" }),
  changedByRole: text("changed_by_role"),
  remarks: text(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  index("srh_request_idx").on(table.requestId, table.createdAt),
]);

// ─── Complaints ──────────────────────────────────────────────────────────────
// Identity is intentionally kept out of `complaint`. The private
// `complaint_submitter` link is the only place a student is tied to a record and
// is never read by admin queries for anonymous complaints.

export const complaints = pgTable("complaint", {
  id: uuid().defaultRandom().primaryKey(),
  referenceNumber: text("reference_number").unique().notNull(),
  subject: text().notNull(),
  category: text().notNull(),
  description: text().notNull(),
  attachmentName: text("attachment_name"),
  attachmentType: text("attachment_type"),
  attachmentSize: integer("attachment_size"),
  attachmentData: text("attachment_data"),
  status: text().default("pending").notNull(), // "pending" | "in_review" | "resolved"
  adminRemarks: text("admin_remarks").default("").notNull(),
  isAnonymous: boolean("is_anonymous").default(false).notNull(),
  lastUpdatedById: uuid("last_updated_by_id").references(() => users.id, { onDelete: "set null" }),
  lastUpdatedByRole: text("last_updated_by_role"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  index("complaint_status_idx").on(table.status),
  index("complaint_created_idx").on(table.createdAt),
]);

export const complaintSubmitters = pgTable("complaint_submitter", {
  complaintId: uuid("complaint_id").primaryKey().references(() => complaints.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  index("complaint_submitter_user_idx").on(table.userId, table.createdAt),
]);

// ─── Academic Calendar ───────────────────────────────────────────────────────

export const academicEvents = pgTable("academic_event", {
  id: uuid().defaultRandom().primaryKey(),
  title: text().notNull(),
  description: text().default("").notNull(),
  category: text().notNull(),
  /** Inclusive calendar dates, `YYYY-MM-DD`. */
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  /** 24-hour clock, e.g. `"08:00"`. */
  startTime: text("start_time"),
  endTime: text("end_time"),
  allDay: boolean("all_day").default(false).notNull(),
  schoolYear: text("school_year").notNull(),
  semester: text().notNull(),
  status: text().default("draft").notNull(), // draft | pending | published | archived | cancelled
  location: text(),
  organizer: text(),
  department: text(),
  notes: text(),
  programs: text().array().notNull(),
  targetAudience: text("target_audience"),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdByRole: text("created_by_role"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull().$onUpdate(() => new Date().toISOString()),
}, (table) => [
  index("academic_event_start_idx").on(table.startDate),
  index("academic_event_status_idx").on(table.status),
  index("academic_event_year_semester_idx").on(table.schoolYear, table.semester),
]);

export const notifications = pgTable("notification", {
  id: uuid().defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  message: text("message").notNull(),
  type: text("type").default("info").notNull(), // "info" | "success" | "warning"
  officeId: text("office_id"),
  href: text("href"),
  read: boolean("read").default(false).notNull(),
  readAt: timestamp("read_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  index("notification_user_idx").on(table.userId),
  index("notification_user_read_created_idx").on(table.userId, table.read, table.createdAt),
]);

// ─── Online Enrollment (Continuing Students - Spec Section 5) ───────────────

export const masterlist = pgTable("masterlist", {
  id: uuid().defaultRandom().primaryKey(),
  studentIdNo: text("student_id_no").unique().notNull(),
  name: text().notNull(),
  department: text().notNull(),
  course: text().notNull(),
  yearLevel: integer("year_level").notNull(),
  semester: integer().default(1).notNull(),
  standing: text().default("regular").notNull(), // "regular" | "irregular"
  lastTermEnrolled: text("last_term_enrolled").notNull(),
  isEligible: boolean("is_eligible").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  index("masterlist_student_id_idx").on(table.studentIdNo),
  index("masterlist_dept_idx").on(table.department),
]);

export const enrollmentForms = pgTable("enrollment_form", {
  id: text().primaryKey(),
  studentId: text("student_id").notNull(),
  studentName: text("student_name").notNull(),
  department: text().notNull(),
  course: text().notNull(),
  yearLevel: integer("year_level").notNull(),
  term: text().notNull(),
  type: text().notNull(), // "preprinted" | "blank"
  standing: text().notNull(), // "regular" | "irregular"
  totalUnits: integer("total_units").default(0).notNull(),
  status: text().default("DRAFT").notNull(), // "DRAFT" | "SUBMITTED" | "APPROVED" | "RESUBMIT"
  approvedBy: text("approved_by"),
  screeningRemarks: text("screening_remarks"),
  guidanceRemarks: text("guidance_remarks"),
  submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  index("enr_form_student_idx").on(table.studentId),
  index("enr_form_status_idx").on(table.status),
]);

export const formSubjects = pgTable("form_subject", {
  id: text().primaryKey(),
  formId: text("form_id").notNull().references(() => enrollmentForms.id, { onDelete: "cascade" }),
  code: text().notNull(),
  title: text().notNull(),
  units: integer().notNull(),
  schedule: text().notNull(),
  room: text(),
  instructor: text(),
}, (table) => [
  index("form_subj_form_idx").on(table.formId),
]);

export const workflowSteps = pgTable("workflow_step", {
  id: uuid().defaultRandom().primaryKey(),
  studentId: text("student_id").notNull(),
  stepName: text("step_name").notNull(),
  office: text().notNull(),
  status: text().default("LOCKED").notNull(), // "LOCKED" | "PENDING" | "APPROVED" | "REJECTED" | "RESUBMIT"
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }),
  remarks: text(),
}, (table) => [
  index("wf_student_idx").on(table.studentId),
  index("wf_step_idx").on(table.stepName),
]);

export const departmentSchedules = pgTable("department_schedule", {
  id: text().primaryKey(),
  department: text().notNull(),
  term: text().notNull(),
  date: text().notNull(), // YYYY-MM-DD
  yearGroup: text("year_group").notNull(), // "1-2" | "3-4"
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  slots: integer().default(100).notNull(),
  remainingSlots: integer("remaining_slots").default(100).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

/** Canonical cross-device enrollment state. Detailed actions are validated in the enrollment service. */
export const enrollmentSessions = pgTable("enrollment_session", {
  studentId: text("student_id").primaryKey().references(() => masterlist.studentIdNo, { onDelete: "cascade" }),
  session: jsonb("session").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull().$onUpdate(() => new Date().toISOString()),
}, (table) => [index("enrollment_session_updated_idx").on(table.updatedAt)]);

export const queueTickets = pgTable("queue_ticket", {
  id: text().primaryKey(),
  studentId: text("student_id").notNull(),
  studentName: text("student_name").notNull(),
  department: text().notNull(),
  yearLevel: integer("year_level").notNull(),
  yearGroup: text("year_group").notNull(),
  number: text().notNull(), // e.g. "BSIT-001"
  scheduleDate: text("schedule_date").notNull(),
  timeBlock: text("time_block").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  index("queue_number_idx").on(table.number),
  index("queue_dept_idx").on(table.department),
]);

export const queueOfficeStatus = pgTable("queue_office_status", {
  id: uuid().defaultRandom().primaryKey(),
  ticketId: text("ticket_id").notNull().references(() => queueTickets.id, { onDelete: "cascade" }),
  office: text().notNull(), // "clinic" | "accounting" | "registrar"
  status: text().default("WAITING").notNull(), // "WAITING" | "CALLED" | "SERVING" | "DONE" | "MOVED_TO_LAST"
  recalls: integer().default(0).notNull(),
  position: integer().default(1).notNull(),
  servedBy: text("served_by"),
  calledAt: timestamp("called_at", { withTimezone: true, mode: "string" }),
  doneAt: timestamp("done_at", { withTimezone: true, mode: "string" }),
}, (table) => [
  index("queue_office_ticket_idx").on(table.ticketId, table.office),
  index("queue_office_status_idx").on(table.office, table.status),
]);

export const auditLogs = pgTable("audit_log", {
  id: text().primaryKey(),
  actorId: text("actor_id").notNull(),
  actorName: text("actor_name").notNull(),
  actorRole: text("actor_role").notNull(),
  action: text().notNull(),
  target: text().notNull(),
  remarks: text(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (table) => [
  index("audit_created_idx").on(table.createdAt),
]);


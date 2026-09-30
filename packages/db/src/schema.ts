/**
 * Kysely table types. Hand-maintained alongside migrations/*.sql.
 * timestamptz columns are read as ISO strings (see pool.ts) and accept Date | string on write.
 */
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from "kysely";

export type Timestamp = ColumnType<string, Date | string, Date | string>;
/** timestamptz with a database default. */
export type TimestampGenerated = ColumnType<string, Date | string | undefined, Date | string>;
/** jsonb: read as parsed value, written as a JSON string. */
export type Json = ColumnType<unknown, string, string>;
export type JsonGenerated = ColumnType<unknown, string | undefined, string>;
export type UUID = string;

export type ResourceKind = "staff" | "chair" | "room" | "device" | "other";
export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
export type AppointmentSource = "online" | "admin" | "ai" | "import";
export type BlockKind = "appointment" | "hold" | "timeoff";
export type ConsentKind = "marketing_email" | "marketing_sms" | "health_notes" | "terms";
export type MembershipRole = "owner" | "admin" | "staff";
export type JobStatus = "pending" | "running" | "done" | "failed" | "cancelled";
export type NotificationChannel = "email" | "sms" | "whatsapp" | "push";
export type NotificationStatus = "queued" | "sent" | "failed" | "skipped";

export interface TenantTable {
  id: Generated<UUID>;
  slug: string;
  name: string;
  timezone: Generated<string>;
  locale: Generated<string>;
  currency: Generated<string>;
  country: Generated<string>;
  vertical: Generated<string>;
  slot_step_min: Generated<number>;
  min_notice_min: Generated<number>;
  max_advance_days: Generated<number>;
  cancel_until_min: Generated<number>;
  reminder_hours: Generated<number[]>;
  settings: JsonGenerated;
  created_at: TimestampGenerated;
  updated_at: TimestampGenerated;
}

export interface UserAccountTable {
  id: Generated<UUID>;
  email: string;
  password_hash: string;
  name: string;
  locale: Generated<string>;
  created_at: TimestampGenerated;
}

export interface MembershipTable {
  user_id: UUID;
  tenant_id: UUID;
  role: MembershipRole;
  created_at: TimestampGenerated;
}

export interface SessionTable {
  id: Generated<UUID>;
  user_id: UUID;
  tenant_id: UUID | null;
  expires_at: Timestamp;
  created_at: TimestampGenerated;
}

export interface LocationTable {
  id: Generated<UUID>;
  tenant_id: UUID;
  name: string;
  address: string | null;
  phone: string | null;
  is_default: Generated<boolean>;
  created_at: TimestampGenerated;
}

export interface ResourceTable {
  id: Generated<UUID>;
  tenant_id: UUID;
  location_id: UUID | null;
  kind: ResourceKind;
  name: string;
  color: string | null;
  user_id: UUID | null;
  bookable_online: Generated<boolean>;
  active: Generated<boolean>;
  sort_order: Generated<number>;
  created_at: TimestampGenerated;
}

export interface AvailabilityRuleTable {
  id: Generated<UUID>;
  tenant_id: UUID;
  resource_id: UUID;
  weekday: number;
  start_time: string; // "HH:mm:ss"
  end_time: string;
}

export interface AvailabilityOverrideTable {
  id: Generated<UUID>;
  tenant_id: UUID;
  resource_id: UUID;
  date: ColumnType<string, string, string>; // "YYYY-MM-DD"
  intervals: JsonGenerated;
  note: string | null;
}

export interface ServiceCategoryTable {
  id: Generated<UUID>;
  tenant_id: UUID;
  name: string;
  sort_order: Generated<number>;
}

export interface ServiceTable {
  id: Generated<UUID>;
  tenant_id: UUID;
  category_id: UUID | null;
  name: string;
  description: string | null;
  price_cents: Generated<number>;
  price_from: Generated<boolean>;
  buffer_before_min: Generated<number>;
  buffer_after_min: Generated<number>;
  bookable_online: Generated<boolean>;
  active: Generated<boolean>;
  color: string | null;
  sort_order: Generated<number>;
  created_at: TimestampGenerated;
}

export interface ServiceRequirementTable {
  id: Generated<UUID>;
  tenant_id: UUID;
  service_id: UUID;
  key: string;
  kind: ResourceKind;
  sort_order: Generated<number>;
}

export interface ServiceRequirementCandidateTable {
  requirement_id: UUID;
  resource_id: UUID;
  tenant_id: UUID;
}

export interface ServiceSegmentTable {
  id: Generated<UUID>;
  tenant_id: UUID;
  service_id: UUID;
  position: number;
  name: string | null;
  duration_min: number;
  kind: "active" | "processing";
  occupies: string[];
}

export interface ClientTable {
  id: Generated<UUID>;
  tenant_id: UUID;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  locale: string | null;
  notes: string | null;
  health_notes: string | null;
  no_show_count: Generated<number>;
  created_at: TimestampGenerated;
  updated_at: TimestampGenerated;
}

export interface ConsentTable {
  id: Generated<UUID>;
  tenant_id: UUID;
  client_id: UUID;
  kind: ConsentKind;
  granted_at: TimestampGenerated;
  revoked_at: Timestamp | null;
  source: string;
  text_version: string | null;
  ip: string | null;
}

export interface AppointmentTable {
  id: Generated<UUID>;
  tenant_id: UUID;
  location_id: UUID | null;
  client_id: UUID | null;
  status: Generated<AppointmentStatus>;
  start_at: Timestamp;
  end_at: Timestamp;
  source: Generated<AppointmentSource>;
  notes: string | null;
  client_note: string | null;
  public_token: Generated<string>;
  cancelled_at: Timestamp | null;
  cancel_reason: string | null;
  created_by: UUID | null;
  created_at: TimestampGenerated;
  updated_at: TimestampGenerated;
}

export interface AppointmentItemTable {
  id: Generated<UUID>;
  tenant_id: UUID;
  appointment_id: UUID;
  service_id: UUID | null;
  position: number;
  service_name: string;
  price_cents: Generated<number>;
}

export interface AppointmentSegmentTable {
  id: Generated<UUID>;
  tenant_id: UUID;
  appointment_id: UUID;
  item_id: UUID;
  position: number;
  kind: "active" | "processing";
  start_at: Timestamp;
  end_at: Timestamp;
  resource_ids: UUID[];
}

export interface ResourceBlockTable {
  id: Generated<UUID>;
  tenant_id: UUID;
  resource_id: UUID;
  /** tstzrange literal, e.g. "[2026-03-23T09:00:00Z,2026-03-23T09:30:00Z)" */
  during: ColumnType<string, string, string>;
  kind: BlockKind;
  appointment_id: UUID | null;
  hold_token: string | null;
  expires_at: Timestamp | null;
  note: string | null;
  blocking: Generated<boolean>;
  created_at: TimestampGenerated;
}

export interface AuditLogTable {
  id: Generated<number>;
  tenant_id: UUID | null;
  actor_id: UUID | null;
  actor_type: Generated<"user" | "client" | "system" | "ai">;
  action: string;
  entity: string;
  entity_id: string | null;
  data: Json | null;
  created_at: TimestampGenerated;
}

export interface JobTable {
  id: Generated<number>;
  tenant_id: UUID | null;
  kind: string;
  payload: JsonGenerated;
  run_at: TimestampGenerated;
  status: Generated<JobStatus>;
  attempts: Generated<number>;
  max_attempts: Generated<number>;
  locked_at: Timestamp | null;
  locked_by: string | null;
  last_error: string | null;
  dedupe_key: string | null;
  created_at: TimestampGenerated;
}

export interface NotificationTable {
  id: Generated<number>;
  tenant_id: UUID;
  appointment_id: UUID | null;
  client_id: UUID | null;
  channel: NotificationChannel;
  template: string;
  recipient: string;
  body_preview: string | null;
  status: Generated<NotificationStatus>;
  provider: string | null;
  provider_message_id: string | null;
  error: string | null;
  sent_at: Timestamp | null;
  created_at: TimestampGenerated;
}

export interface WaitlistEntryTable {
  id: Generated<UUID>;
  tenant_id: UUID;
  client_id: UUID;
  service_ids: UUID[];
  staff_id: UUID | null;
  from_at: Timestamp;
  until_at: Timestamp;
  channel: "email" | "sms";
  status: Generated<"waiting" | "offered" | "notified" | "closed" | "booked">;
  public_token: Generated<string>;
  offer_version: Generated<number>;
  offered_start_at: Timestamp | null;
  offered_end_at: Timestamp | null;
  notification_id: number | null;
  booked_appointment_id: UUID | null;
  requested_at: TimestampGenerated;
  created_by: UUID;
}
export type WaitlistEntry = Selectable<WaitlistEntryTable>;

export interface PublicActionLimitTable {
  tenant_id: UUID;
  action: "hold" | "book" | "cancel" | "sms";
  key_hash: string;
  hits: number;
  expires_at: Timestamp;
}

export interface PhoneChallengeTable {
  tenant_id: UUID;
  token_hash: string;
  phone_hash: string;
  code_hash: string;
  attempts: Generated<number>;
  delivered: Generated<boolean>;
  verified: Generated<boolean>;
  expires_at: TimestampGenerated;
}

export interface DB {
  phone_challenge: PhoneChallengeTable;
  public_action_limit: PublicActionLimitTable;
  waitlist_entry: WaitlistEntryTable;
  tenant: TenantTable;
  user_account: UserAccountTable;
  membership: MembershipTable;
  session: SessionTable;
  location: LocationTable;
  resource: ResourceTable;
  availability_rule: AvailabilityRuleTable;
  availability_override: AvailabilityOverrideTable;
  service_category: ServiceCategoryTable;
  service: ServiceTable;
  service_requirement: ServiceRequirementTable;
  service_requirement_candidate: ServiceRequirementCandidateTable;
  service_segment: ServiceSegmentTable;
  client: ClientTable;
  consent: ConsentTable;
  appointment: AppointmentTable;
  appointment_item: AppointmentItemTable;
  appointment_segment: AppointmentSegmentTable;
  resource_block: ResourceBlockTable;
  audit_log: AuditLogTable;
  job: JobTable;
  notification: NotificationTable;
}

export type Tenant = Selectable<TenantTable>;
export type NewTenant = Insertable<TenantTable>;
export type UserAccount = Selectable<UserAccountTable>;
export type Resource = Selectable<ResourceTable>;
export type NewResource = Insertable<ResourceTable>;
export type ResourceUpdate = Updateable<ResourceTable>;
export type Service = Selectable<ServiceTable>;
export type NewService = Insertable<ServiceTable>;
export type ServiceSegment = Selectable<ServiceSegmentTable>;
export type Client = Selectable<ClientTable>;
export type NewClient = Insertable<ClientTable>;
export type Appointment = Selectable<AppointmentTable>;
export type AppointmentItem = Selectable<AppointmentItemTable>;
export type AppointmentSegment = Selectable<AppointmentSegmentTable>;
export type ResourceBlock = Selectable<ResourceBlockTable>;
export type Job = Selectable<JobTable>;
export type Notification = Selectable<NotificationTable>;

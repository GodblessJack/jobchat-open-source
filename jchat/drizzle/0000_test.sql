CREATE TABLE "agent_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"skill_name" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"inline_content" text,
	"category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"role" text,
	"avatar_url" text,
	"persona_description" text,
	"initial_message" text,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"owner_user_id" uuid,
	"source_type" text,
	"source_url" text,
	"slug" text,
	"identity" jsonb,
	"bootstrap_md" text,
	CONSTRAINT "agents_persona_nonempty" CHECK ("agents"."persona_description" IS NOT NULL AND length("agents"."persona_description") >= 50)
);
--> statement-breakpoint
CREATE TABLE "distillation_quota" (
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "distillation_quota_user_id_date_pk" PRIMARY KEY("user_id","date"),
	CONSTRAINT "distillation_quota_count_check" CHECK ("distillation_quota"."count" >= 0 AND "distillation_quota"."count" <= 100)
);
--> statement-breakpoint
CREATE TABLE "jchat_agent_memory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"source_conversation_id" uuid,
	"source_message_id" uuid,
	"chunk_text" text NOT NULL,
	"embedding" vector(1536),
	"importance" real DEFAULT 0.5 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jchat_conversation_members" (
	"conversation_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active_session" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "jchat_conv_members_role_check" CHECK ("jchat_conversation_members"."role" IN ('member', 'moderator'))
);
--> statement-breakpoint
CREATE TABLE "jchat_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"active_session" uuid,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jchat_conversations_type_check" CHECK ("jchat_conversations"."type" IN ('dm', 'group'))
);
--> statement-breakpoint
CREATE TABLE "jchat_meeting_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "jchat_meeting_sessions_status_check" CHECK ("jchat_meeting_sessions"."status" IN ('ongoing','completed','error'))
);
--> statement-breakpoint
CREATE TABLE "jchat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_type" text NOT NULL,
	"sender_id" uuid NOT NULL,
	"content" text,
	"mentions" uuid[],
	"tool_calls" jsonb,
	"attachments" jsonb,
	"parent_id" uuid,
	"sdk_session_id" uuid,
	"delivery_status" text DEFAULT 'final' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "jchat_messages_sender_type_check" CHECK ("jchat_messages"."sender_type" IN ('user', 'agent', 'system')),
	CONSTRAINT "jchat_messages_delivery_status_check" CHECK ("jchat_messages"."delivery_status" IN ('partial', 'final', 'error'))
);
--> statement-breakpoint
CREATE TABLE "jchat_sdk_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"agent_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_path" text NOT NULL,
	"status" text NOT NULL,
	"worker_pid" integer,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"error_msg" text,
	CONSTRAINT "jchat_sdk_sessions_status_check" CHECK ("jchat_sdk_sessions"."status" IN ('idle','starting','running','cancelled','failed','ended'))
);
--> statement-breakpoint
CREATE TABLE "jchat_user_profile" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"profile_markdown" text,
	"timezone" text,
	"locale" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "local_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	CONSTRAINT "local_users_username_unique" UNIQUE("username"),
	CONSTRAINT "local_users_username_check" CHECK ("local_users"."username" ~ '^[a-zA-Z0-9_-]{3,30}$')
);
--> statement-breakpoint
CREATE TABLE "refresh_token_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"family_id" text NOT NULL,
	"jti" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"replaced_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_token_families_status_check" CHECK ("refresh_token_families"."status" IN ('ACTIVE', 'LOGOUT', 'THEFT_DETECTED'))
);
--> statement-breakpoint
CREATE TABLE "user_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"custom_instructions" text,
	"is_removable" boolean DEFAULT true,
	"last_read_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"linkedin_id" text,
	"full_name" text,
	"avatar_url" text,
	"headline" text,
	"email" text,
	"education" text,
	"experience_years" text,
	"current_title" text,
	"phone" text,
	"basic_info" text,
	"preferences" text,
	"memory" text,
	"profile_version" integer DEFAULT 0,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_linkedin_id_unique" UNIQUE("linkedin_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jchat_agent_memory" ADD CONSTRAINT "jchat_agent_memory_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jchat_agent_memory" ADD CONSTRAINT "jchat_agent_memory_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jchat_agent_memory" ADD CONSTRAINT "jchat_agent_memory_source_conversation_id_jchat_conversations_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."jchat_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jchat_agent_memory" ADD CONSTRAINT "jchat_agent_memory_source_message_id_jchat_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."jchat_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jchat_conversation_members" ADD CONSTRAINT "jchat_conversation_members_conversation_id_jchat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."jchat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jchat_meeting_sessions" ADD CONSTRAINT "jchat_meeting_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jchat_meeting_sessions" ADD CONSTRAINT "jchat_meeting_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jchat_meeting_sessions" ADD CONSTRAINT "jchat_meeting_sessions_conversation_id_jchat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."jchat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jchat_sdk_sessions" ADD CONSTRAINT "jchat_sdk_sessions_conversation_id_jchat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."jchat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jchat_sdk_sessions" ADD CONSTRAINT "jchat_sdk_sessions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jchat_sdk_sessions" ADD CONSTRAINT "jchat_sdk_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_token_families" ADD CONSTRAINT "refresh_token_families_user_id_local_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."local_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_agents" ADD CONSTRAINT "user_agents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_skills_agent_skill_uniq" ON "agent_skills" USING btree ("agent_id","skill_name");--> statement-breakpoint
CREATE INDEX "idx_agent_skills_agent_id" ON "agent_skills" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_user_id") WHERE "agents"."owner_user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_owner_slug_uniq" ON "agents" USING btree ("owner_user_id","slug") WHERE "agents"."owner_user_id" IS NOT NULL AND "agents"."slug" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "jchat_conv_members_pk" ON "jchat_conversation_members" USING btree ("conversation_id","agent_id");--> statement-breakpoint
CREATE INDEX "idx_jchat_conv_members_agent" ON "jchat_conversation_members" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "idx_jchat_conv_members_position" ON "jchat_conversation_members" USING btree ("conversation_id","position");--> statement-breakpoint
CREATE INDEX "idx_jchat_conv_user_updated" ON "jchat_conversations" USING btree ("user_id","updated_at" DESC) WHERE "jchat_conversations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_jchat_meeting_sessions_user_started" ON "jchat_meeting_sessions" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_jchat_meeting_sessions_conversation" ON "jchat_meeting_sessions" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_jchat_meeting_sessions_status_started" ON "jchat_meeting_sessions" USING btree ("status","started_at") WHERE "jchat_meeting_sessions"."status" = 'ongoing';--> statement-breakpoint
CREATE INDEX "idx_jchat_msg_conv_created" ON "jchat_messages" USING btree ("conversation_id","created_at") WHERE "jchat_messages"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_jchat_msg_sender_agent" ON "jchat_messages" USING btree ("sender_id") WHERE "jchat_messages"."sender_type" = 'agent';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_jchat_messages_transcript_entry_unique" ON "jchat_messages" USING btree ("conversation_id",("metadata"->>'transcriptEntryId')) WHERE "jchat_messages"."metadata"->>'source' = 'call';--> statement-breakpoint
CREATE INDEX "idx_jchat_sdk_active" ON "jchat_sdk_sessions" USING btree ("conversation_id","status");--> statement-breakpoint
CREATE INDEX "idx_jchat_sdk_agent_running" ON "jchat_sdk_sessions" USING btree ("agent_id","status") WHERE "jchat_sdk_sessions"."status" = 'running';--> statement-breakpoint
CREATE INDEX "idx_jchat_sdk_running_last_active" ON "jchat_sdk_sessions" USING btree ("status","last_active_at") WHERE "jchat_sdk_sessions"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_refresh_families_family_jti_uniq" ON "refresh_token_families" USING btree ("family_id","jti");--> statement-breakpoint
CREATE INDEX "idx_refresh_families_user" ON "refresh_token_families" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_families_active" ON "refresh_token_families" USING btree ("expires_at") WHERE "refresh_token_families"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "user_agents_user_agent_uniq" ON "user_agents" USING btree ("user_id","agent_id") WHERE "user_agents"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_user_agents_user_id" ON "user_agents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_agents_agent_id" ON "user_agents" USING btree ("agent_id");
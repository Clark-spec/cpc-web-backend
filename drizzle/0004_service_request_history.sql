CREATE TABLE "service_request_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"old_status" text,
	"new_status" text NOT NULL,
	"changed_by_id" uuid,
	"changed_by_role" text,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_request" ADD COLUMN "attachment_name" text;--> statement-breakpoint
ALTER TABLE "service_request" ADD COLUMN "attachment_type" text;--> statement-breakpoint
ALTER TABLE "service_request" ADD COLUMN "attachment_size" integer;--> statement-breakpoint
ALTER TABLE "service_request" ADD COLUMN "attachment_data" text;--> statement-breakpoint
ALTER TABLE "service_request" ADD COLUMN "last_updated_by_id" uuid;--> statement-breakpoint
ALTER TABLE "service_request" ADD COLUMN "last_updated_by_role" text;--> statement-breakpoint
ALTER TABLE "service_request_history" ADD CONSTRAINT "service_request_history_request_id_service_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_history" ADD CONSTRAINT "service_request_history_changed_by_id_user_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "srh_request_idx" ON "service_request_history" USING btree ("request_id","created_at");--> statement-breakpoint
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_last_updated_by_id_user_id_fk" FOREIGN KEY ("last_updated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sr_status_idx" ON "service_request" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sr_submitted_idx" ON "service_request" USING btree ("submitted_at");
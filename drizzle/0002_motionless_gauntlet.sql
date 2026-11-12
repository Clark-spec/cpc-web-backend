CREATE TABLE "complaint_submitter" (
	"complaint_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference_number" text NOT NULL,
	"subject" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"attachment_name" text,
	"attachment_type" text,
	"attachment_size" integer,
	"attachment_data" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"admin_remarks" text DEFAULT '' NOT NULL,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"last_updated_by_id" uuid,
	"last_updated_by_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complaint_reference_number_unique" UNIQUE("reference_number")
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"message" text NOT NULL,
	"type" text DEFAULT 'info' NOT NULL,
	"office_id" text,
	"href" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "complaint_submitter" ADD CONSTRAINT "complaint_submitter_complaint_id_complaint_id_fk" FOREIGN KEY ("complaint_id") REFERENCES "public"."complaint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_submitter" ADD CONSTRAINT "complaint_submitter_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint" ADD CONSTRAINT "complaint_last_updated_by_id_user_id_fk" FOREIGN KEY ("last_updated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "complaint_submitter_user_idx" ON "complaint_submitter" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "complaint_status_idx" ON "complaint" USING btree ("status");--> statement-breakpoint
CREATE INDEX "complaint_created_idx" ON "complaint" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notification_user_idx" ON "notification" USING btree ("user_id");
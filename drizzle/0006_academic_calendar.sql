CREATE TABLE "academic_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"start_time" text,
	"end_time" text,
	"all_day" boolean DEFAULT false NOT NULL,
	"school_year" text NOT NULL,
	"semester" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"location" text,
	"organizer" text,
	"department" text,
	"notes" text,
	"programs" text[] NOT NULL,
	"target_audience" text,
	"created_by_id" uuid,
	"created_by_role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "academic_event" ADD CONSTRAINT "academic_event_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academic_event_start_idx" ON "academic_event" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "academic_event_status_idx" ON "academic_event" USING btree ("status");--> statement-breakpoint
CREATE INDEX "academic_event_year_semester_idx" ON "academic_event" USING btree ("school_year","semester");

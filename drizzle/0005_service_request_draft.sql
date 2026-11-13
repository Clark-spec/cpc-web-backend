CREATE TABLE "service_request_draft" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"service_id" integer,
	"copies" integer DEFAULT 1 NOT NULL,
	"purpose" text,
	"notes" text,
	"attachment_name" text,
	"attachment_type" text,
	"attachment_size" integer,
	"attachment_data" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_request_draft" ADD CONSTRAINT "service_request_draft_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;

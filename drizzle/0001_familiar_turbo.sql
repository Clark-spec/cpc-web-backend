ALTER TYPE "public"."Role" ADD VALUE IF NOT EXISTS 'STUDENT' BEFORE 'ADMIN';--> statement-breakpoint
ALTER TYPE "public"."Role" ADD VALUE IF NOT EXISTS 'REGISTRAR';--> statement-breakpoint
ALTER TYPE "public"."Role" ADD VALUE IF NOT EXISTS 'DEAN';--> statement-breakpoint
ALTER TYPE "public"."Role" ADD VALUE IF NOT EXISTS 'LIBRARY';--> statement-breakpoint
ALTER TYPE "public"."Role" ADD VALUE IF NOT EXISTS 'ACCOUNTING';--> statement-breakpoint
ALTER TYPE "public"."Role" ADD VALUE IF NOT EXISTS 'SAO';--> statement-breakpoint
ALTER TYPE "public"."Role" ADD VALUE IF NOT EXISTS 'INSTRUCTOR';--> statement-breakpoint
ALTER TYPE "public"."Role" ADD VALUE IF NOT EXISTS 'GUIDANCE';--> statement-breakpoint
ALTER TYPE "public"."Role" ADD VALUE IF NOT EXISTS 'CLINIC';--> statement-breakpoint
CREATE TABLE "purpose" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference_number" text NOT NULL,
	"user_id" uuid NOT NULL,
	"service_id" integer NOT NULL,
	"copies" integer DEFAULT 1 NOT NULL,
	"purpose" text,
	"notes" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"remarks" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_request_reference_number_unique" UNIQUE("reference_number")
);
--> statement-breakpoint
CREATE TABLE "service" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '',
	"fee" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "student_profile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"phone" text,
	"alternate_contact" text,
	"street" text,
	"barangay" text,
	"city" text,
	"province" text,
	"gender" text,
	"date_of_birth" text,
	"place_of_birth" text,
	"civil_status" text,
	"religion" text,
	"nationality" text,
	"mother_name" text,
	"father_name" text,
	"guardian_name" text,
	"guardian_contact" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_profile_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "password" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'STUDENT';--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "student_number" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "course" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "year_level" integer;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "department" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "avatar_url" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "phone" text;--> statement-breakpoint
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_service_id_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."service"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profile" ADD CONSTRAINT "student_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sr_user_idx" ON "service_request" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_student_number_unique" UNIQUE("student_number");

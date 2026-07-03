CREATE TABLE "reports" (
	"id" serial PRIMARY KEY,
	"hash" text NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now()
);

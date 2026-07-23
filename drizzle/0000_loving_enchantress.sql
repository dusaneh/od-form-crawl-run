CREATE TABLE `form_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`target_url` text NOT NULL,
	`urls_json` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`mode` text DEFAULT 'crawl' NOT NULL,
	`graph_json` text NOT NULL,
	`findings_json` text NOT NULL,
	`synthetic` integer DEFAULT true NOT NULL,
	`live_approved` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`reason_code` text,
	`message` text NOT NULL,
	`evidence_key` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

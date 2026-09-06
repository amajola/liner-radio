CREATE TABLE `track_uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`object_key` text NOT NULL,
	`upload_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`mime_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`duration` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_track_uploads_owner` ON `track_uploads` (`owner`);

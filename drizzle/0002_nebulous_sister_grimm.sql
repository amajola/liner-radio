CREATE TABLE `audio_tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`duration` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audio_tracks_object_key_unique` ON `audio_tracks` (`object_key`);--> statement-breakpoint
CREATE INDEX `idx_audio_tracks_owner` ON `audio_tracks` (`owner`);
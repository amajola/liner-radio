CREATE TABLE `radio_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_radio_rooms_owner` ON `radio_rooms` (`owner`);
CREATE TABLE `music_albums` (
	`id` text PRIMARY KEY,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`album_artist` text NOT NULL,
	`genre` text,
	`year` integer,
	`artwork_url` text,
	`musicbrainz_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_music_albums_owner_user_id_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `track_metadata` (
	`track_id` text PRIMARY KEY,
	`owner` text NOT NULL,
	`album_id` text,
	`genre` text,
	`year` integer,
	`track_number` integer,
	`disc_number` integer,
	`artwork_url` text,
	`musicbrainz_id` text,
	`metadata_source` text DEFAULT 'manual' NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_track_metadata_track_id_audio_tracks_id_fk` FOREIGN KEY (`track_id`) REFERENCES `audio_tracks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_track_metadata_owner_user_id_fk` FOREIGN KEY (`owner`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_track_metadata_album_id_music_albums_id_fk` FOREIGN KEY (`album_id`) REFERENCES `music_albums`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `idx_music_albums_owner` ON `music_albums` (`owner`);--> statement-breakpoint
CREATE INDEX `idx_music_albums_owner_artist` ON `music_albums` (`owner`,`album_artist`);--> statement-breakpoint
CREATE INDEX `idx_track_metadata_owner` ON `track_metadata` (`owner`);--> statement-breakpoint
CREATE INDEX `idx_track_metadata_album` ON `track_metadata` (`album_id`);--> statement-breakpoint
CREATE INDEX `idx_track_metadata_owner_genre` ON `track_metadata` (`owner`,`genre`);
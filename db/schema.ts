import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { user } from './auth-schema';

export * from './auth-schema';

export const radioRooms = sqliteTable('radio_rooms', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  state: text('state').notNull(),
  revision: integer('revision').notNull().default(0),
}, table=>[index('idx_radio_rooms_owner').on(table.owner)]);

/**
 * An R2 multipart upload in flight. Kept out of `audio_tracks` deliberately:
 * playback, the library listing and the grant endpoint all query that table
 * with no status filter, so a half-uploaded object stored there would be one
 * forgotten `where` clause away from reaching a listener. A separate table
 * makes a pending upload structurally invisible instead.
 */
export const trackUploads = sqliteTable('track_uploads', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull().references(() => user.id, { onDelete: 'cascade' }),
  objectKey: text('object_key').notNull(),
  uploadId: text('upload_id').notNull(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  mimeType: text('mime_type').notNull(),
  bytes: integer('bytes').notNull(),
  duration: integer('duration').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, table => [index('idx_track_uploads_owner').on(table.owner)]);

export const audioTracks = sqliteTable('audio_tracks', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull().references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  objectKey: text('object_key').notNull().unique(),
  mimeType: text('mime_type').notNull(),
  bytes: integer('bytes').notNull(),
  duration: integer('duration').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, table => [index('idx_audio_tracks_owner').on(table.owner)]);

/**
 * Release-level information stays separate from the audio object. A release
 * can therefore be edited once and immediately update every track in an album
 * without rewriting or moving a large R2 object.
 */
export const musicAlbums = sqliteTable('music_albums', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull().references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  albumArtist: text('album_artist').notNull(),
  genre: text('genre'),
  year: integer('year'),
  artworkUrl: text('artwork_url'),
  musicBrainzId: text('musicbrainz_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, table => [
  index('idx_music_albums_owner').on(table.owner),
  index('idx_music_albums_owner_artist').on(table.owner, table.albumArtist),
]);

/** Searchable tags for an uploaded object. Kept one-to-one with audio_tracks. */
export const trackMetadata = sqliteTable('track_metadata', {
  trackId: text('track_id').primaryKey().references(() => audioTracks.id, { onDelete: 'cascade' }),
  owner: text('owner').notNull().references(() => user.id, { onDelete: 'cascade' }),
  albumId: text('album_id').references(() => musicAlbums.id, { onDelete: 'set null' }),
  genre: text('genre'),
  year: integer('year'),
  trackNumber: integer('track_number'),
  discNumber: integer('disc_number'),
  artworkUrl: text('artwork_url'),
  musicBrainzId: text('musicbrainz_id'),
  metadataSource: text('metadata_source').notNull().default('manual'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, table => [
  index('idx_track_metadata_owner').on(table.owner),
  index('idx_track_metadata_album').on(table.albumId),
  index('idx_track_metadata_owner_genre').on(table.owner, table.genre),
]);

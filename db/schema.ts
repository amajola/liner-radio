import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { user } from './auth-schema';

export * from './auth-schema';

export const radioRooms = sqliteTable('radio_rooms', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  state: text('state').notNull(),
  revision: integer('revision').notNull().default(0),
}, table=>[index('idx_radio_rooms_owner').on(table.owner)]);

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

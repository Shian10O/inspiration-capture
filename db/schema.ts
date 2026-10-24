import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';
export const config=sqliteTable('config',{key:text('key').primaryKey(),value:text('value').notNull()});
export const devices=sqliteTable('devices',{id:text('id').primaryKey(),label:text('label').notNull(),tokenHash:text('token_hash').notNull().unique(),createdAt:text('created_at').notNull(),revokedAt:text('revoked_at')});
export const records=sqliteTable('records',{key:text('record_key').primaryKey(),root:text('root_event_id').notNull().unique(),page:text('page_id'),url:text('notion_url'),createdAt:text('created_at').notNull()});
export const events=sqliteTable('events',{id:text('id').primaryKey(),device:text('device_id').notNull(),hash:text('payload_hash').notNull(),recordKey:text('record_key').notNull(),payload:text('payload_json').notNull(),state:text('state').notNull(),page:text('page_id'),error:text('error_code'),retryAt:integer('retry_at'),updatedAt:text('updated_at').notNull()},t=>[index('events_record_key').on(t.recordKey)]);
export const locks=sqliteTable('locks',{key:text('record_key').primaryKey(),event:text('event_id').notNull(),acquiredAt:integer('acquired_at').notNull()});

import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const backupTask = sqliteTable('backup_task', {
	taskId: integer('task_id').primaryKey({ autoIncrement: true }),
	type: text('type').notNull(),
	status: text('status').notNull().default('pending'),
	sourceKeys: text('source_keys').notNull().default('[]'),
	resultKey: text('result_key'),
	fileIndex: integer('file_index').notNull().default(0),
	cursor: integer('cursor').notNull().default(0),
	total: integer('total').notNull().default(0),
	processed: integer('processed').notNull().default(0),
	skipped: integer('skipped').notNull().default(0),
	failed: integer('failed').notNull().default(0),
	params: text('params').notNull().default('{}'),
	detailLog: text('detail_log').notNull().default('[]'),
	createTime: text('create_time').notNull().default(sql`CURRENT_TIMESTAMP`),
	updateTime: text('update_time').notNull().default(sql`CURRENT_TIMESTAMP`),
	expireTime: text('expire_time')
});

export default backupTask;

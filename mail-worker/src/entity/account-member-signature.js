import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const accountMemberSignature = sqliteTable('account_member_signature', {
	sigId: integer('sig_id').primaryKey({ autoIncrement: true }),
	accountId: integer('account_id').notNull(),
	userId: integer('user_id').notNull(),
	sigUid: text('sig_uid').notNull(),
	name: text('name').notNull().default(''),
	content: text('content').notNull().default(''),
	isDefault: integer('is_default').default(0).notNull(),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`).notNull()
});
export default accountMemberSignature;

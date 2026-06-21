import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const accountMember = sqliteTable('account_member', {
	memberId: integer('member_id').primaryKey({ autoIncrement: true }),
	accountId: integer('account_id').notNull(),
	userId: integer('user_id').notNull(),
	role: integer('role').default(0).notNull(),
	lastSigScope: text('last_sig_scope').default('').notNull(),
	lastSigId: text('last_sig_id').default('').notNull(),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`).notNull()
});
export default accountMember;

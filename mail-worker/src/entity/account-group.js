import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const accountGroup = sqliteTable('account_group', {
	groupId: integer('group_id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull(),
	name: text('name').notNull(),
	sort: integer('sort').default(0).notNull()
});
export default accountGroup

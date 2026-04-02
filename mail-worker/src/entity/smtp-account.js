import { sqliteTable, text, integer} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const smtpAccount = sqliteTable('smtp_account', {
	smtpAccountId: integer('smtp_account_id').primaryKey({ autoIncrement: true }),
	accountId: integer('account_id').notNull(),
	name: text('name').notNull(),
	host: text('host').notNull(),
	port: integer('port').notNull(),
	user: text('user').notNull(),
	password: text('password').notNull(),
	secure: integer('secure').default(1).notNull(),
	authType: text('auth_type').default('plain').notNull(),
	isDefault: integer('is_default').default(0).notNull(),
	mailcowServerId: text('mailcow_server_id').default('').notNull(),
	status: integer('status').default(1).notNull(),
	createTime: text('create_time').default(sql`CURRENT_TIMESTAMP`),
	updateTime: text('update_time').default(sql`CURRENT_TIMESTAMP`)
});

export default smtpAccount
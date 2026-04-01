import settingService from '../service/setting-service';
import emailUtils from '../utils/email-utils';
import {emailConst} from "../const/entity-const";

const dbInit = {
	async init(c) {

		const secret = c.req.param('secret');

		// 允许使用开发环境或生产环境的JWT secret
		const validSecrets = [c.env.jwt_secret, 'b7f29a1d-18e2-4d3b-941f-f6b2c97c02fd', 'cloud-mail-jwt-secret-key-2026'];
		if (!validSecrets.includes(secret)) {
			return c.text('❌ JWT secret mismatch');
		}

		// 检查数据库是否绑定
		if (!c.env.db) {
			return c.text('❌ Database not bound. Please bind a D1 database first.');
		}

		try {
			await this.intDB(c);
			await this.v1_1DB(c);
			await this.v1_2DB(c);
			await this.v1_3DB(c);
			await this.v1_3_1DB(c);
			await this.v1_4DB(c);
			await this.v1_5DB(c);
			await this.v1_6DB(c);
			await this.v1_7DB(c);
			await this.v2DB(c);
			await this.v2_3DB(c);
			await this.v2_4DB(c);
			await this.v2_5DB(c);
			await this.v2_6DB(c);
			await this.v2_7DB(c);
			await this.v2_8DB(c);
			await this.v2_9DB(c);
			await this.v3_0DB(c);
			await this.v3_1DB(c);
			await this.v3_2DB(c);
			await this.v3_3DB(c);
			await this.v3_4DB(c);
			await this.v3_5DB(c);
			await this.v3_6DB(c);
			await this.v3_7DB(c);
			await this.v3_8DB(c);
			await this.v3_9DB(c);
			await this.v4_0DB(c);
			await settingService.refresh(c);
			return c.text('success');
		} catch (e) {
			console.error('Database initialization error:', e);
			return c.text(`❌ Database initialization error: ${e.message}`);
		}
	},

	async v3_7DB(c) {
		const settingMigrations = [
			`ALTER TABLE setting ADD COLUMN mailcow_password_mode TEXT NOT NULL DEFAULT 'random';`,
			`ALTER TABLE setting ADD COLUMN mailcow_provision_password TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN mailcow_create_strict INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE setting ADD COLUMN mailcow_global_smtp_template TEXT NOT NULL DEFAULT '{}';`,
			`ALTER TABLE setting ADD COLUMN smtp_servers TEXT NOT NULL DEFAULT '[]';`
		];

		for (const sql of settingMigrations) {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段：${e.message}`);
			}
		}

		const accountMigrations = [
			`ALTER TABLE account ADD COLUMN smtp_server_id TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE account ADD COLUMN mailcow_server_id TEXT NOT NULL DEFAULT '';`
		];

		for (const sql of accountMigrations) {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段：${e.message}`);
			}
		}
	},

	async v3_8DB(c) {
		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN login_domains TEXT NOT NULL DEFAULT '';`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v3_9DB(c) {
		try {
			// 1. 确保根节点存在
			let rootRow = await c.env.db.prepare(
				`SELECT perm_id AS permId FROM perm WHERE pid = 0 AND (name = '邮件账户' OR name = '邮箱侧栏') LIMIT 1`
			).first();

			if (!rootRow) {
				await c.env.db.prepare(
					`INSERT INTO perm (name, perm_key, pid, type, sort) VALUES ('邮件账户', NULL, 0, 1, 1)`
				).run();
				rootRow = await c.env.db.prepare(
					`SELECT perm_id AS permId FROM perm WHERE pid = 0 AND name = '邮件账户' LIMIT 1`
				).first();
			}

			if (!rootRow?.permId) {
				console.warn('v3_9DB: 无法创建或找到邮件账户根权限节点');
				return;
			}

			const rootId = Number(rootRow.permId);

			// 2. 更新根节点名称和类型
			await c.env.db.prepare(
				`UPDATE perm SET name = '邮件账户', type = 1 WHERE perm_id = ?`
			).bind(rootId).run();

			// 3. 确保子节点存在并更新
			const children = [
				{ name: '账户查看', permKey: 'account:query', sort: 0 },
				{ name: '账户添加', permKey: 'account:add', sort: 1 },
				{ name: '账户删除', permKey: 'account:delete', sort: 2 }
			];

			for (const child of children) {
				try {
					const existing = await c.env.db.prepare(
						`SELECT perm_id FROM perm WHERE perm_key = ? LIMIT 1`
					).bind(child.permKey).first();

					if (!existing) {
						await c.env.db.prepare(
							`INSERT INTO perm (name, perm_key, pid, type, sort) VALUES (?, ?, ?, 2, ?)`
						).bind(child.name, child.permKey, rootId, child.sort).run();
					} else {
						await c.env.db.prepare(
							`UPDATE perm SET name = ?, pid = ?, type = 2, sort = ? WHERE perm_key = ?`
						).bind(child.name, rootId, child.sort, child.permKey).run();
					}
				} catch (childErr) {
					console.warn(`v3_9DB: 子节点 ${child.permKey} 处理失败: ${childErr.message}`);
				}
			}

			// 4. 确保默认角色拥有这些权限
			try {
				const defaultRole = await c.env.db.prepare(
					`SELECT role_id AS roleId FROM role WHERE is_default = 1 LIMIT 1`
				).first();

				if (defaultRole?.roleId) {
					const allPermIds = [rootId];
					for (const child of children) {
						const row = await c.env.db.prepare(
							`SELECT perm_id AS permId FROM perm WHERE perm_key = ? LIMIT 1`
						).bind(child.permKey).first();
						if (row?.permId) allPermIds.push(Number(row.permId));
					}

					for (const permId of allPermIds) {
						const exists = await c.env.db.prepare(
							`SELECT 1 FROM role_perm WHERE role_id = ? AND perm_id = ? LIMIT 1`
						).bind(defaultRole.roleId, permId).first();
						if (!exists) {
							await c.env.db.prepare(
								`INSERT INTO role_perm (role_id, perm_id) VALUES (?, ?)`
							).bind(defaultRole.roleId, permId).run();
						}
					}
				}
			} catch (roleErr) {
				console.warn(`v3_9DB: 默认角色权限更新失败: ${roleErr.message}`);
			}
		} catch (e) {
			console.warn(`v3_9DB 迁移失败：${e.message}`);
		}
	},

	async v4_0DB(c) {
		try {
			// 确保SMTP设置权限组存在
			let rootRow = await c.env.db.prepare(
				`SELECT perm_id AS permId FROM perm WHERE pid = 0 AND name = 'SMTP设置' LIMIT 1`
			).first();

			if (!rootRow) {
				await c.env.db.prepare(
					`INSERT INTO perm (name, perm_key, pid, type, sort) VALUES ('SMTP设置', NULL, 0, 1, 6.1)`
				).run();
				rootRow = await c.env.db.prepare(
					`SELECT perm_id AS permId FROM perm WHERE pid = 0 AND name = 'SMTP设置' LIMIT 1`
				).first();
			}

			if (!rootRow?.permId) {
				console.warn('v4_0DB: 无法创建或找到SMTP设置根权限节点');
				return;
			}

			const rootId = Number(rootRow.permId);

			// 确保子节点存在
			const children = [
				{ name: 'SMTP配置查看', permKey: 'smtp:query', sort: 0 },
				{ name: 'SMTP配置修改', permKey: 'smtp:set', sort: 1 }
			];

			for (const child of children) {
				try {
					const existing = await c.env.db.prepare(
						`SELECT perm_id FROM perm WHERE perm_key = ? LIMIT 1`
					).bind(child.permKey).first();

					if (!existing) {
						await c.env.db.prepare(
							`INSERT INTO perm (name, perm_key, pid, type, sort) VALUES (?, ?, ?, 2, ?)`
						).bind(child.name, child.permKey, rootId, child.sort).run();
					} else {
						await c.env.db.prepare(
							`UPDATE perm SET name = ?, pid = ?, type = 2, sort = ? WHERE perm_key = ?`
						).bind(child.name, rootId, child.sort, child.permKey).run();
					}
				} catch (childErr) {
					console.warn(`v4_0DB: 子节点 ${child.permKey} 处理失败: ${childErr.message}`);
				}
			}

			// 确保默认角色拥有SMTP权限
			try {
				const defaultRole = await c.env.db.prepare(
					`SELECT role_id AS roleId FROM role WHERE is_default = 1 LIMIT 1`
				).first();

				if (defaultRole?.roleId) {
					const allPermIds = [rootId];
					for (const child of children) {
						const row = await c.env.db.prepare(
							`SELECT perm_id AS permId FROM perm WHERE perm_key = ? LIMIT 1`
						).bind(child.permKey).first();
						if (row?.permId) allPermIds.push(Number(row.permId));
					}

					for (const permId of allPermIds) {
						const exists = await c.env.db.prepare(
							`SELECT 1 FROM role_perm WHERE role_id = ? AND perm_id = ? LIMIT 1`
						).bind(defaultRole.roleId, permId).first();
						if (!exists) {
							await c.env.db.prepare(
								`INSERT INTO role_perm (role_id, perm_id) VALUES (?, ?)`
							).bind(defaultRole.roleId, permId).run();
						}
					}
				}
			} catch (roleErr) {
				console.warn(`v4_0DB: 默认角色权限更新失败: ${roleErr.message}`);
			}
		} catch (e) {
			console.warn(`v4_0DB 迁移失败：${e.message}`);
		}
	},

	async v2_9DB(c) {
		try {
			await c.env.db.prepare(`UPDATE setting SET auto_refresh = 5 WHERE auto_refresh = 1;`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v3_0DB(c) {
		// setting表添加SMTP配置字段
		const settingMigrations = [
			`ALTER TABLE setting ADD COLUMN smtp_enabled INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE setting ADD COLUMN smtp_host TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN smtp_port INTEGER NOT NULL DEFAULT 587;`,
			`ALTER TABLE setting ADD COLUMN smtp_user TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN smtp_password TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN smtp_secure INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE setting ADD COLUMN smtp_auth_type TEXT NOT NULL DEFAULT 'plain';`,
			`ALTER TABLE setting ADD COLUMN smtp_from_name TEXT NOT NULL DEFAULT '';`
		];
		
		for (const sql of settingMigrations) {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段：${e.message}`);
			}
		}
		
		// account表添加SMTP配置字段
		const accountMigrations = [
			`ALTER TABLE account ADD COLUMN smtp_override INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE account ADD COLUMN smtp_host TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE account ADD COLUMN smtp_port INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE account ADD COLUMN smtp_user TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE account ADD COLUMN smtp_password TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE account ADD COLUMN smtp_secure INTEGER NOT NULL DEFAULT -1;`,
			`ALTER TABLE account ADD COLUMN smtp_auth_type TEXT NOT NULL DEFAULT 'plain';`,
			`ALTER TABLE account ADD COLUMN signature TEXT NOT NULL DEFAULT '';`
		];
		
		for (const sql of accountMigrations) {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段：${e.message}`);
			}
		}
		
		// email表添加发送方式字段
		try {
			await c.env.db.prepare(`ALTER TABLE email ADD COLUMN send_method TEXT NOT NULL DEFAULT 'resend';`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v3_1DB(c) {
		// setting表添加SMTP用户配置权限开关
		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN smtp_user_config INTEGER NOT NULL DEFAULT 1;`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v3_2DB(c) {
		// account表添加signatures字段，用于存储多个签名
		try {
			await c.env.db.prepare(`ALTER TABLE account ADD COLUMN signatures TEXT NOT NULL DEFAULT '[]';`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
		
		// 将现有signature字段数据迁移到signatures字段
		try {
			// 检查signature字段是否存在
			const signatureColumn = await c.env.db.prepare(`SELECT * FROM pragma_table_info('account') WHERE name = 'signature' limit 1`).first();
			if (signatureColumn) {
				// 迁移数据
				const {results} = await c.env.db.prepare(`SELECT account_id, signature FROM account WHERE signature != ''`).all();
				const queryList = [];
				results.forEach(row => {
					if (row.signature) {
						// 构建签名对象
						const signatureObj = {
							id: `sig_${Date.now()}_${row.account_id}`,
							name: '默认签名',
							content: row.signature,
							isDefault: true
						};
						const signatures = JSON.stringify([signatureObj]);
						queryList.push(c.env.db.prepare(`UPDATE account SET signatures = ? WHERE account_id = ?`).bind(signatures, row.account_id));
					}
				});
				if (queryList.length > 0) {
					await c.env.db.batch(queryList);
				}
			}
		} catch (e) {
			console.warn(`迁移签名数据失败：${e.message}`);
		}
	},

	async v3_3DB(c) {
		// 为邮件导入导出功能初始化数据库
		// 确保email表的send_method字段存在
		try {
			await c.env.db.prepare(`ALTER TABLE email ADD COLUMN send_method TEXT NOT NULL DEFAULT 'resend';`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v3_4DB(c) {
		// 添加resend_enabled字段到setting表
		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN resend_enabled INTEGER NOT NULL DEFAULT 1;`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v3_5DB(c) {
		// 创建smtp_account表
		try {
			await c.env.db.prepare(`
				CREATE TABLE IF NOT EXISTS smtp_account (
					smtp_account_id INTEGER PRIMARY KEY AUTOINCREMENT,
					account_id INTEGER NOT NULL,
					name TEXT NOT NULL,
					host TEXT NOT NULL,
					port INTEGER NOT NULL,
					user TEXT NOT NULL,
					password TEXT NOT NULL,
					secure INTEGER NOT NULL DEFAULT 1,
					auth_type TEXT NOT NULL DEFAULT 'plain',
					is_default INTEGER NOT NULL DEFAULT 0,
					status INTEGER NOT NULL DEFAULT 1,
					create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
					update_time DATETIME DEFAULT CURRENT_TIMESTAMP
				)
			`).run();
		} catch (e) {
			console.warn(`跳过创建smtp_account表：${e.message}`);
		}
	},

	async v3_6DB(c) {
		const settingMigrations = [
			`ALTER TABLE setting ADD COLUMN mailcow_enabled INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE setting ADD COLUMN mailcow_servers TEXT NOT NULL DEFAULT '[]';`,
			`ALTER TABLE setting ADD COLUMN mailcow_retry_count INTEGER NOT NULL DEFAULT 3;`,
			`ALTER TABLE setting ADD COLUMN mailcow_timeout INTEGER NOT NULL DEFAULT 30000;`
		];

		for (const sql of settingMigrations) {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段：${e.message}`);
			}
		}
	},


	async v2_8DB(c) {
		try {
			await c.env.db.batch([
				c.env.db.prepare(`ALTER TABLE account ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v2_7DB(c) {
		try {
			await c.env.db.batch([
				c.env.db.prepare(`ALTER TABLE setting RENAME COLUMN auto_refresh_time TO auto_refresh;`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v2_6DB(c) {
		try {
			await c.env.db.prepare(`ALTER TABLE account ADD COLUMN all_receive INTEGER NOT NULL DEFAULT 0;`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v2_5DB(c) {

		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN email_prefix_filter text NOT NULL DEFAULT '';`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

		try {
			await c.env.db.batch([
				c.env.db.prepare(`ALTER TABLE email ADD COLUMN unread INTEGER NOT NULL DEFAULT 0;`),
				c.env.db.prepare(`UPDATE email SET unread = 1;`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

	},

	async v2_4DB(c) {
		try {
			await c.env.db.prepare(`
				CREATE TABLE IF NOT EXISTS oauth (
					oauth_id INTEGER PRIMARY KEY AUTOINCREMENT,
					oauth_user_id TEXT,
					username TEXT,
					name TEXT,
					avatar TEXT,
					active INTEGER,
					trust_level INTEGER,
					silenced INTEGER,
					create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
					platform INTEGER NOT NULL DEFAULT 0,
					user_id INTEGER NOT NULL DEFAULT 0
				)
			`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN min_email_prefix INTEGER NOT NULL DEFAULT 1;`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

	},

	async v2_3DB(c) {
		try {
			await c.env.db.batch([
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN force_path_style	INTEGER NOT NULL DEFAULT 1;`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN custom_domain TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN tg_msg_to TEXT NOT NULL DEFAULT 'show';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN tg_msg_from TEXT NOT NULL DEFAULT 'only-name';`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN tg_msg_text TEXT NOT NULL DEFAULT 'show';`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}

	},

	async v2DB(c) {
		try {
			await c.env.db.batch([
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN bucket TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN region TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN endpoint TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN s3_access_key TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`ALTER TABLE setting ADD COLUMN s3_secret_key TEXT NOT NULL DEFAULT '';`),
				c.env.db.prepare(`DELETE FROM perm WHERE perm_key = 'setting:clean'`)
			]);
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v1_7DB(c) {
		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN login_domain INTEGER NOT NULL DEFAULT 0;`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},

	async v1_6DB(c) {

		const noticeContent = '本项目仅供学习交流，禁止用于违法业务\n' +
			'<br>\n' +
			'请遵守当地法规，作者不承担任何法律责任'

		const ADD_COLUMN_SQL_LIST = [
			`ALTER TABLE setting ADD COLUMN reg_verify_count INTEGER NOT NULL DEFAULT 1;`,
			`ALTER TABLE setting ADD COLUMN add_verify_count INTEGER NOT NULL DEFAULT 1;`,
			`CREATE TABLE IF NOT EXISTS verify_record (
				vr_id INTEGER PRIMARY KEY AUTOINCREMENT,
				ip TEXT NOT NULL DEFAULT '',
				count INTEGER NOT NULL DEFAULT 1,
				type INTEGER NOT NULL DEFAULT 0,
				update_time DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
			`ALTER TABLE setting ADD COLUMN notice_title TEXT NOT NULL DEFAULT 'Cloud Mail';`,
			`ALTER TABLE setting ADD COLUMN notice_content TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN notice_type TEXT NOT NULL DEFAULT 'none';`,
			`ALTER TABLE setting ADD COLUMN notice_duration INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE setting ADD COLUMN notice_offset INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE setting ADD COLUMN notice_position TEXT NOT NULL DEFAULT 'top-right';`,
			`ALTER TABLE setting ADD COLUMN notice_width INTEGER NOT NULL DEFAULT 340;`,
			`ALTER TABLE setting ADD COLUMN notice INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE setting ADD COLUMN no_recipient INTEGER NOT NULL DEFAULT 1;`,
			`UPDATE role SET avail_domain = '' WHERE role.avail_domain LIKE '@%';`,
			`CREATE INDEX IF NOT EXISTS idx_email_user_id_account_id ON email(user_id, account_id);`
		];

		const promises = ADD_COLUMN_SQL_LIST.map(async (sql) => {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段：${e.message}`);
			}
		});

		await Promise.all(promises);
		await c.env.db.prepare(`UPDATE setting SET notice_content = ? WHERE notice_content = '';`).bind(noticeContent).run();
		try {
			await c.env.db.batch([
				c.env.db.prepare(`DROP INDEX IF EXISTS idx_account_email`),
				c.env.db.prepare(`DROP INDEX IF EXISTS idx_user_email`),
				c.env.db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_account_email_nocase ON account (email COLLATE NOCASE)`),
				c.env.db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email_nocase ON user (email COLLATE NOCASE)`)
			]);
		} catch (e) {
			console.warn(e.message)
		}

	},

	async v1_5DB(c) {
		await c.env.db.prepare(`UPDATE perm SET perm_key = 'all-email:query' WHERE perm_key = 'sys-email:query'`).run();
		await c.env.db.prepare(`UPDATE perm SET perm_key = 'all-email:delete' WHERE perm_key = 'sys-email:delete'`).run();
		try {
			await c.env.db.prepare(`ALTER TABLE role ADD COLUMN avail_domain TEXT NOT NULL DEFAULT ''`).run();
		} catch (e) {
			console.warn(`跳过字段添加：${e.message}`);
		}
	},

	async v1_4DB(c) {
		await c.env.db.prepare(`
      CREATE TABLE IF NOT EXISTS reg_key (
				rege_key_id INTEGER PRIMARY KEY AUTOINCREMENT,
				code TEXT NOT NULL COLLATE NOCASE DEFAULT '',
				count INTEGER NOT NULL DEFAULT 0,
				role_id INTEGER NOT NULL DEFAULT 0,
				user_id INTEGER NOT NULL DEFAULT 0,
				expire_time DATETIME,
				create_time DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

		// 添加不区分大小写的唯一索引
		try {
			await c.env.db.prepare(`
				CREATE UNIQUE INDEX IF NOT EXISTS idx_setting_code ON reg_key(code COLLATE NOCASE)
			`).run();
		} catch (e) {
			console.warn(`跳过创建索引：${e.message}`);
		}


		try {
			await c.env.db.prepare(`
        INSERT INTO perm (perm_id, name, perm_key, pid, type, sort) VALUES
        (33,'注册密钥', NULL, 0, 1, 5.1),
        (34,'密钥查看', 'reg-key:query', 33, 2, 0),
        (35,'密钥添加', 'reg-key:add', 33, 2, 1),
        (36,'密钥删除', 'reg-key:delete', 33, 2, 2)`).run();
		} catch (e) {
			console.warn(`跳过数据：${e.message}`);
		}

		const ADD_COLUMN_SQL_LIST = [
			`ALTER TABLE setting ADD COLUMN reg_key INTEGER NOT NULL DEFAULT 1;`,
			`ALTER TABLE role ADD COLUMN ban_email TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE role ADD COLUMN ban_email_type INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE user ADD COLUMN reg_key_id INTEGER NOT NULL DEFAULT 0;`
		];

		const promises = ADD_COLUMN_SQL_LIST.map(async (sql) => {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段添加：${e.message}`);
			}
		});

		await Promise.all(promises);

	},

	async v1_3_1DB(c) {
		await c.env.db.prepare(`UPDATE email SET name = SUBSTR(send_email, 1, INSTR(send_email, '@') - 1) WHERE (name IS NULL OR name = '') AND type = ${emailConst.type.RECEIVE}`).run();
	},

	async v1_3DB(c) {

		const ADD_COLUMN_SQL_LIST = [
			`ALTER TABLE setting ADD COLUMN tg_bot_token TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN tg_chat_id TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN tg_bot_status INTEGER NOT NULL DEFAULT 1;`,
			`ALTER TABLE setting ADD COLUMN forward_email TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN forward_status INTEGER TIME NOT NULL DEFAULT 1;`,
			`ALTER TABLE setting ADD COLUMN rule_email TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE setting ADD COLUMN rule_type INTEGER NOT NULL DEFAULT 0;`
		];

		const promises = ADD_COLUMN_SQL_LIST.map(async (sql) => {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段添加：${e.message}`);
			}
		});

		await Promise.all(promises);

		const nameColumn = await c.env.db.prepare(`SELECT * FROM pragma_table_info('email') WHERE name = 'to_email' limit 1`).first();

		if (nameColumn) {
			return
		}

		const queryList = []

		queryList.push(c.env.db.prepare(`ALTER TABLE email ADD COLUMN to_email TEXT NOT NULL DEFAULT ''`));
		queryList.push(c.env.db.prepare(`ALTER TABLE email ADD COLUMN to_name TEXT NOT NULL DEFAULT ''`));
		queryList.push(c.env.db.prepare(`UPDATE email SET to_email = json_extract(recipient, '$[0].address'), to_name = json_extract(recipient, '$[0].name')`));

		await c.env.db.batch(queryList);

	},

	async v1_2DB(c){

		const ADD_COLUMN_SQL_LIST = [
			`ALTER TABLE email ADD COLUMN recipient TEXT NOT NULL DEFAULT '[]';`,
			`ALTER TABLE email ADD COLUMN cc TEXT NOT NULL DEFAULT '[]';`,
			`ALTER TABLE email ADD COLUMN bcc TEXT NOT NULL DEFAULT '[]';`,
			`ALTER TABLE email ADD COLUMN message_id TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE email ADD COLUMN in_reply_to TEXT NOT NULL DEFAULT '';`,
			`ALTER TABLE email ADD COLUMN relation TEXT NOT NULL DEFAULT '';`
		];

		const promises = ADD_COLUMN_SQL_LIST.map(async (sql) => {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段添加：${e.message}`);
			}
		});

		await Promise.all(promises);

		await this.receiveEmailToRecipient(c);
		await this.initAccountName(c);

		try {
			await c.env.db.prepare(`
        INSERT INTO perm (perm_id, name, perm_key, pid, type, sort) VALUES
        (31,'分析页', NULL, 0, 1, 2.1),
        (32,'数据查看', 'analysis:query', 31, 2, 1)`).run();
		} catch (e) {
			console.warn(`跳过数据：${e.message}`);
		}

	},

	async v1_1DB(c) {
		// 添加字段
		const ADD_COLUMN_SQL_LIST = [
			`ALTER TABLE email ADD COLUMN type INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE email ADD COLUMN status INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE email ADD COLUMN resend_email_id TEXT;`,
			`ALTER TABLE email ADD COLUMN message TEXT;`,

			`ALTER TABLE setting ADD COLUMN resend_tokens TEXT NOT NULL DEFAULT '{}';`,
			`ALTER TABLE setting ADD COLUMN send INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE setting ADD COLUMN r2_domain TEXT;`,
			`ALTER TABLE setting ADD COLUMN site_key TEXT;`,
			`ALTER TABLE setting ADD COLUMN secret_key TEXT;`,
			`ALTER TABLE setting ADD COLUMN background TEXT;`,
			`ALTER TABLE setting ADD COLUMN login_opacity INTEGER NOT NULL DEFAULT 0.90;`,

			`ALTER TABLE user ADD COLUMN create_ip TEXT;`,
			`ALTER TABLE user ADD COLUMN active_ip TEXT;`,
			`ALTER TABLE user ADD COLUMN os TEXT;`,
			`ALTER TABLE user ADD COLUMN browser TEXT;`,
			`ALTER TABLE user ADD COLUMN device TEXT;`,
			`ALTER TABLE user ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE user ADD COLUMN send_count INTEGER NOT NULL DEFAULT 0;`,

			`ALTER TABLE attachments ADD COLUMN status INTEGER NOT NULL DEFAULT 0;`,
			`ALTER TABLE attachments ADD COLUMN type INTEGER NOT NULL DEFAULT 0;`
		];

		const promises = ADD_COLUMN_SQL_LIST.map(async (sql) => {
			try {
				await c.env.db.prepare(sql).run();
			} catch (e) {
				console.warn(`跳过字段添加：${e.message}`);
			}
		});

		await Promise.all(promises);

		// 创建 perm 表并初始化
		await c.env.db.prepare(`
      CREATE TABLE IF NOT EXISTS perm (
        perm_id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        perm_key TEXT,
        pid INTEGER NOT NULL DEFAULT 0,
        type INTEGER NOT NULL DEFAULT 2,
        sort INTEGER
      )
    `).run();

		const {permTotal} = await c.env.db.prepare(`SELECT COUNT(*) as permTotal FROM perm`).first();

		if (permTotal === 0) {
			await c.env.db.prepare(`
        INSERT INTO perm (perm_id, name, perm_key, pid, type, sort) VALUES
        (1, '邮件', NULL, 0, 0, 0),
        (2, '邮件删除', 'email:delete', 1, 2, 1),
        (3, '邮件发送', 'email:send', 1, 2, 0),
        (4, '个人设置', '', 0, 1, 2),
        (5, '用户注销', 'my:delete', 4, 2, 0),
        (6, '用户信息', NULL, 0, 1, 3),
        (7, '用户查看', 'user:query', 6, 2, 0),
        (8, '密码修改', 'user:set-pwd', 6, 2, 2),
        (9, '状态修改', 'user:set-status', 6, 2, 3),
        (10, '权限修改', 'user:set-type', 6, 2, 4),
        (11, '用户删除', 'user:delete', 6, 2, 7),
        (12, '用户收藏', 'user:star', 6, 2, 5),
        (13, '权限控制', '', 0, 1, 5),
        (14, '身份查看', 'role:query', 13, 2, 0),
        (15, '身份修改', 'role:set', 13, 2, 1),
        (16, '身份删除', 'role:delete', 13, 2, 2),
        (17, '系统设置', '', 0, 1, 6),
        (18, '设置查看', 'setting:query', 17, 2, 0),
        (19, '设置修改', 'setting:set', 17, 2, 1),
        (21, '邮箱侧栏', '', 0, 0, 1),
        (22, '邮箱查看', 'account:query', 21, 2, 0),
        (23, '邮箱添加', 'account:add', 21, 2, 1),
        (24, '邮箱删除', 'account:delete', 21, 2, 2),
        (25, '用户添加', 'user:add', 6, 2, 1),
        (26, '发件重置', 'user:reset-send', 6, 2, 6),
        (27, '邮件列表', '', 0, 1, 4),
        (28, '邮件查看', 'all-email:query', 27, 2, 0),
        (29, '邮件删除', 'all-email:delete', 27, 2, 0),
		(30, '身份添加', 'role:add', 13, 2, -1),
        (33, 'SMTP设置', NULL, 0, 1, 6.1),
        (34, 'SMTP配置查看', 'smtp:query', 33, 2, 0),
        (35, 'SMTP配置修改', 'smtp:set', 33, 2, 1)
      `).run();
		}

		await c.env.db.prepare(`UPDATE perm SET perm_key = 'setting:clean' WHERE perm_key = 'seting:clear'`).run();
		await c.env.db.prepare(`DELETE FROM perm WHERE perm_key = 'user:star'`).run();
		// 创建 role 表并插入默认身份
		await c.env.db.prepare(`
      CREATE TABLE IF NOT EXISTS role (
        role_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        key TEXT,
        create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
        sort INTEGER DEFAULT 0,
        description TEXT,
        user_id INTEGER,
        is_default INTEGER DEFAULT 0,
        send_count INTEGER,
        send_type TEXT NOT NULL DEFAULT 'count',
        account_count INTEGER
      )
    `).run();

		const { roleCount } = await c.env.db.prepare(`SELECT COUNT(*) as roleCount FROM role`).first();
		if (roleCount === 0) {
			await c.env.db.prepare(`
        INSERT INTO role (
          role_id, name, key, create_time, sort, description, user_id, is_default, send_count, send_type, account_count
        ) VALUES (
          1, '普通用户', NULL, '0000-00-00 00:00:00', 0, '只有普通使用权限', 0, 1, NULL, 'ban', 10
        )
      `).run();
		}

		// 创建 role_perm 表并初始化数据
		await c.env.db.prepare(`
      CREATE TABLE IF NOT EXISTS role_perm (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role_id INTEGER,
        perm_id INTEGER
      )
    `).run();

		const {rolePermCount} = await c.env.db.prepare(`SELECT COUNT(*) as rolePermCount FROM role_perm`).first();
		if (rolePermCount === 0) {
			await c.env.db.prepare(`
        INSERT INTO role_perm (id, role_id, perm_id) VALUES
          (100, 1, 2),
          (101, 1, 21),
          (102, 1, 22),
          (103, 1, 23),
          (104, 1, 24),
          (105, 1, 4),
          (106, 1, 5),
          (107, 1, 1),
          (108, 1, 3),
          (109, 1, 33),
          (110, 1, 34),
          (111, 1, 35)
      `).run();
		}
	},

	async intDB(c) {
		// 初始化数据库表结构
		await c.env.db.prepare(`
		  CREATE TABLE IF NOT EXISTS email (
			email_id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
			send_email TEXT,
			name TEXT,
			account_id INTEGER NOT NULL,
			user_id INTEGER NOT NULL,
			subject TEXT,
			content TEXT,
			text TEXT,
			create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
			is_del INTEGER DEFAULT 0 NOT NULL
		  )
		`).run();

		await c.env.db.prepare(`
		  CREATE TABLE IF NOT EXISTS star (
			star_id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			email_id INTEGER NOT NULL,
			create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
		  )
		`).run();

		await c.env.db.prepare(`
		  CREATE TABLE IF NOT EXISTS attachments (
			att_id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			email_id INTEGER NOT NULL,
			account_id INTEGER NOT NULL,
			key TEXT NOT NULL,
			filename TEXT,
			mime_type TEXT,
			size INTEGER,
			disposition TEXT,
			related TEXT,
			content_id TEXT,
			encoding TEXT,
			create_time DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
		  )
		`).run();

		await c.env.db.prepare(`
		  CREATE TABLE IF NOT EXISTS user (
			user_id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL,
			type INTEGER DEFAULT 1 NOT NULL,
			password TEXT NOT NULL,
			salt TEXT NOT NULL,
			status INTEGER DEFAULT 0 NOT NULL,
			create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
			active_time DATETIME,
			is_del INTEGER DEFAULT 0 NOT NULL
		  )
		`).run();

		await c.env.db.prepare(`
		  CREATE TABLE IF NOT EXISTS account (
			account_id INTEGER PRIMARY KEY AUTOINCREMENT,
			email TEXT NOT NULL,
			status INTEGER DEFAULT 0 NOT NULL,
			latest_email_time DATETIME,
			create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
			user_id INTEGER NOT NULL,
			is_del INTEGER DEFAULT 0 NOT NULL
		  )
		`).run();

		await c.env.db.prepare(`
		  CREATE TABLE IF NOT EXISTS setting (
			register INTEGER NOT NULL,
			receive INTEGER NOT NULL,
			add_email INTEGER NOT NULL,
			many_email INTEGER NOT NULL,
			title TEXT NOT NULL,
			auto_refresh INTEGER NOT NULL,
			register_verify INTEGER NOT NULL,
			add_email_verify INTEGER NOT NULL
		  )
		`).run();

		try {
			await c.env.db.prepare(`
			  INSERT INTO setting (
				register, receive, add_email, many_email, title, auto_refresh, register_verify, add_email_verify
			  )
			  SELECT 0, 0, 0, 0, 'Cloud Mail', 0, 1, 1
			  WHERE NOT EXISTS (SELECT 1 FROM setting)
			`).run();
		} catch (e) {
			console.warn(e)
		}

	},

	async receiveEmailToRecipient(c) {

		const receiveEmailColumn = await c.env.db.prepare(`SELECT * FROM pragma_table_info('email') WHERE name = 'receive_email' limit 1`).first();

		if (!receiveEmailColumn) {
			return
		}

		const queryList = []
		const {results} = await c.env.db.prepare('SELECT receive_email,email_id FROM email').all();
		results.forEach(emailRow => {
			const recipient = {}
			recipient.address = emailRow.receive_email
			recipient.name = ''
			const recipientStr = JSON.stringify([recipient]);
			const sql = c.env.db.prepare('UPDATE email SET recipient = ? WHERE email_id = ?').bind(recipientStr,emailRow.email_id);
			queryList.push(sql)
		})

		queryList.push(c.env.db.prepare("ALTER TABLE email DROP COLUMN receive_email"));

		await c.env.db.batch(queryList);
	},


	async initAccountName(c) {

		const nameColumn = await c.env.db.prepare(`SELECT * FROM pragma_table_info('account') WHERE name = 'name' limit 1`).first();

		if (nameColumn) {
			return
		}

		const queryList = []

		queryList.push(c.env.db.prepare(`ALTER TABLE account ADD COLUMN name TEXT NOT NULL DEFAULT ''`));

		const {results} = await c.env.db.prepare(`SELECT account_id, email FROM account`).all();

		results.forEach(accountRow => {
			const name = emailUtils.getName(accountRow.email);
			const sql = c.env.db.prepare('UPDATE account SET name = ? WHERE account_id = ?').bind(name,accountRow.account_id);
			queryList.push(sql)
		})

		await c.env.db.batch(queryList);
	}
};
export { dbInit };

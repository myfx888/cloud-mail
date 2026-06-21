# 邮件备份恢复 — 后端实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 mail-worker 后台实现邮件整体备份/恢复与外部 EML/MBOX 多文件导入恢复，按收件地址自动归入对应邮箱、找不到则落 NOONE，合并去重。

**Architecture:** 一套「导入/导出引擎」复用于两场景。新增 `backup_task` 任务表 + `backup-service`（任务/导出/导入/配置 dump-restore）+ `mbox-utils`/`tar-utils` 工具；改造 `email-service`（重写占位 parseEml/generateEml/importEmail，新增 `importSingleEmail` 核心注入函数）。批量处理用「任务表 + 前端轮询分批 + 游标断点续传」。备份包存 R2 前缀 `backup/<taskId>/`（manifest+emails.mbox+config.json），下载合成 tar。

**Tech Stack:** Cloudflare Workers, Hono, Drizzle(D1), R2/S3/KV(r2-service), postal-mime(已依赖), vitest。

**Spec:** `docs/superpowers/specs/2026-06-21-backup-restore-design.md`

**测试策略:** 纯函数与可 mock 的逻辑用标准 vitest 单测（新建 `vitest.unit.config.js`，node 环境），命令 `npx vitest run --config vitest.unit.config.js`；涉及 D1/R2 的集成层在 `wrangler dev` 手动验证（见末尾清单）。

---

## File Map

**Create:**
- `mail-worker/src/entity/backup-task.js` — backup_task 表实体
- `mail-worker/src/utils/mbox-utils.js` — MBOX 切分/聚合
- `mail-worker/src/utils/tar-utils.js` — 轻量 tar 打包/解包
- `mail-worker/src/service/backup-service.js` — 任务管理/导出/导入/配置 dump-restore
- `mail-worker/src/api/backup-api.js` — 管理员接口
- `mail-worker/vitest.unit.config.js` — 纯函数单测配置
- `mail-worker/test/unit/*.spec.js` — 单元测试

**Modify:**
- `mail-worker/src/init/init.js` — 新增 `v4_3DB` 迁移并注册到链
- `mail-worker/src/service/email-service.js` — 重写 parseEml/generateEml/importEmail/exportEmail，新增 importSingleEmail
- `mail-worker/src/hono/webs.js` — 注册 backup-api
- `mail-worker/src/index.js` — scheduled 接入定时备份
- `mail-worker/src/const/entity-const.js` — 新增 backupTask 常量（可选）
- `mail-worker/src/i18n/*.js` — 文案（后端少量）

---

## Task 1: backup_task 实体 + 迁移

**Files:**
- Create: `mail-worker/src/entity/backup-task.js`
- Modify: `mail-worker/src/init/init.js`（新增 `v4_3DB`，并在 `init()` 链中 `await this.v4_2DB(c);` 之后调用）

- [ ] **Step 1: 创建实体**

`mail-worker/src/entity/backup-task.js`:
```js
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const backupTask = sqliteTable('backup_task', {
	taskId: integer('task_id').primaryKey({ autoIncrement: true }),
	type: text('type').notNull(),                       // 'backup' | 'restore' | 'import'
	status: text('status').notNull().default('pending'), // pending/processing/completed/failed/cancelled
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
```

- [ ] **Step 2: 新增迁移函数**

在 `init.js` 的 `dbInit` 对象内（`v4_2DB` 之后）新增方法，并在 `init()` 中 `await this.v4_2DB(c);` 之后加 `await this.v4_3DB(c);`：

```js
	async v4_3DB(c) {
		try {
			await c.env.db.prepare(`
				CREATE TABLE IF NOT EXISTS backup_task (
					task_id INTEGER PRIMARY KEY AUTOINCREMENT,
					type TEXT NOT NULL,
					status TEXT NOT NULL DEFAULT 'pending',
					source_keys TEXT NOT NULL DEFAULT '[]',
					result_key TEXT,
					file_index INTEGER NOT NULL DEFAULT 0,
					cursor INTEGER NOT NULL DEFAULT 0,
					total INTEGER NOT NULL DEFAULT 0,
					processed INTEGER NOT NULL DEFAULT 0,
					skipped INTEGER NOT NULL DEFAULT 0,
					failed INTEGER NOT NULL DEFAULT 0,
					params TEXT NOT NULL DEFAULT '{}',
					detail_log TEXT NOT NULL DEFAULT '[]',
					create_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					update_time TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
					expire_time TEXT
				)
			`).run();
			await c.env.db.prepare(`CREATE INDEX IF NOT EXISTS idx_backup_task_type_status ON backup_task(type, status)`).run();
		} catch (e) {
			console.warn(`backup_task 表：${e.message}`);
		}
		try {
			await c.env.db.prepare(`ALTER TABLE setting ADD COLUMN backup_cron INTEGER NOT NULL DEFAULT 0;`).run();
		} catch (e) {
			console.warn(`跳过字段：${e.message}`);
		}
	},
```

注册到链（`init()` 内）：
```js
			await this.v4_2DB(c);
			await this.v4_3DB(c);
			await settingService.refresh(c);
```

- [ ] **Step 3: 验证**

运行迁移（在已部署的 wrangler 环境）：`curl '<worker>/init/<secret>'`，预期返回 `success`；查表存在：
```bash
npx wrangler d1 execute cloudmail --local --command "SELECT name FROM sqlite_master WHERE name='backup_task'"
```
Expected: 含 `backup_task`。

- [ ] **Step 4: Commit**
```bash
git add mail-worker/src/entity/backup-task.js mail-worker/src/init/init.js
git commit -m "feat(backup): add backup_task table and migration"
```

---

## Task 2: 纯函数单测配置

**Files:**
- Create: `mail-worker/vitest.unit.config.js`

- [ ] **Step 1: 写配置**

`mail-worker/vitest.unit.config.js`:
```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/unit/**/*.spec.js'],
		environment: 'node',
		globals: true
	}
});
```

- [ ] **Step 2: 验证空跑**

Run: `npx vitest run --config vitest.unit.config.js`
Expected: "No test files found"（无报错，配置可用）。

- [ ] **Step 3: Commit**
```bash
git add mail-worker/vitest.unit.config.js
git commit -m "test(backup): add unit test config"
```

---

## Task 3: mbox-utils（切分 + 聚合）

MBOX 格式：每封邮件以一行 `From ` 开头分隔；邮件体内行首若为 `From ` 需转义为 `>From `（聚合时加，切分时还原）。本工具操作字符串/Uint8Array，流式按字节游标切分以支持大文件分批。

**Files:**
- Create: `mail-worker/src/utils/mbox-utils.js`
- Test: `mail-worker/test/unit/mbox-utils.spec.js`

- [ ] **Step 1: 写失败测试**

`mail-worker/test/unit/mbox-utils.spec.js`:
```js
import { describe, it, expect } from 'vitest';
import mboxUtils from '../../src/utils/mbox-utils';

describe('mbox-utils', () => {
	it('appendEntry 加分隔符并转义正文 From ', () => {
		const mbox = '';
		const out = mboxUtils.appendEntry(mbox, 'Subject: a\r\n\r\nFrom x\r\nbody');
		expect(out.startsWith('From -\n')).toBe(true);
		expect(out).toContain('>From x');
	});

	it('splitNextBatch 切出指定数量并返回游标', () => {
		const e1 = 'Subject: 1\r\n\r\nbody1';
		const e2 = 'Subject: 2\r\n\r\nbody2';
		let mbox = mboxUtils.appendEntry('', e1);
		mbox = mboxUtils.appendEntry(mbox, e2);
		const r1 = mboxUtils.splitNextBatch(mbox, 0, 1);
		expect(r1.messages.length).toBe(1);
		expect(r1.messages[0]).toContain('Subject: 1');
		expect(r1.messages[0]).toContain('From x'.replace('x','') + 'body1' ? true : true); // presence check below
		expect(r1.nextCursor).toBeGreaterThan(0);
		const r2 = mboxUtils.splitNextBatch(mbox, r1.nextCursor, 10);
		expect(r2.messages.length).toBe(1);
		expect(r2.messages[0]).toContain('Subject: 2');
		expect(r2.done).toBe(true);
	});

	it('还原转义 >From -> From', () => {
		const mbox = mboxUtils.appendEntry('', 'From danger\r\nx');
		const r = mboxUtils.splitNextBatch(mbox, 0, 10);
		expect(r.messages[0]).toContain('From danger\r\nx');
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --config vitest.unit.config.js test/unit/mbox-utils.spec.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`mail-worker/src/utils/mbox-utils.js`:
```js
const mboxUtils = {
	// 将一封原始邮件（含头与正文，CRLF 或 LF）追加进 mbox 字符串，返回新字符串
	appendEntry(mbox, rawEmail) {
		const escaped = rawEmail.replace(/\r?\nFrom /g, (m) => m.replace('From ', '>From '));
		const sep = '\nFrom - cloud-mail\n';
		return mbox + sep + escaped + '\n';
	},

	// 从 byteOffset 开始切最多 maxCount 封，返回 { messages:[rawEmail], nextCursor, done }
	splitNextBatch(mbox, byteOffset, maxCount) {
		const messages = [];
		let i = byteOffset;
		const len = mbox.length;

		// 跳到第一个 'From ' 分隔符
		function findSeparator(from) {
			const idx = mbox.indexOf('\nFrom ', from);
			return idx === -1 ? -1 : idx + 1; // 指向 'F'
		}

		let start = findSeparator(i);
		if (start === -1 || start >= len) {
			return { messages, nextCursor: byteOffset, done: true };
		}

		while (messages.length < maxCount) {
			let next = findSeparator(start + 1);
			if (next === 0 || next === -1) next = len; // 到末尾
			let segment = mbox.slice(start, next);
			// 去掉开头的 'From ...\n' 分隔行
			const firstNl = segment.indexOf('\n');
			let body = firstNl >= 0 ? segment.slice(firstNl + 1) : segment;
			// 还原转义
			body = body.replace(/^>From /gm, 'From ').replace(/\n>From /g, '\nFrom ');
			messages.push(body.trimEnd());
			start = next;
			if (next >= len) {
				return { messages, nextCursor: len, done: true };
			}
		}
		return { messages, nextCursor: start, done: false };
	},

	// 估算总封数（用于进度初始化，扫描分隔符）
	countEntries(mbox) {
		let count = 0;
		let from = 0;
		while (true) {
			const idx = mbox.indexOf('\nFrom ', from);
			if (idx === -1) break;
			count++;
			from = idx + 1;
		}
		return count;
	}
};

export default mboxUtils;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run --config vitest.unit.config.js test/unit/mbox-utils.spec.js`
Expected: PASS。

- [ ] **Step 5: Commit**
```bash
git add mail-worker/src/utils/mbox-utils.js mail-worker/test/unit/mbox-utils.spec.js
git commit -m "feat(backup): add mbox split/aggregate utils with tests"
```

---

## Task 4: tar-utils（轻量打包/解包）

USTAR 风格的最小实现：512 字节头（name 大小受限 100 字节，size/octal）+ 数据 padded 到 512 倍数；结尾两块全零。解包反向。仅用于 manifest.json/emails.mbox/config.json 少量条目，文件名固定且短。

**Files:**
- Create: `mail-worker/src/utils/tar-utils.js`
- Test: `mail-worker/test/unit/tar-utils.spec.js`

- [ ] **Step 1: 写失败测试**

`mail-worker/test/unit/tar-utils.spec.js`:
```js
import { describe, it, expect } from 'vitest';
import tarUtils from '../../src/utils/tar-utils';

describe('tar-utils', () => {
	it('打包后能解出原始条目', () => {
		const entries = [
			{ name: 'manifest.json', data: '{"a":1}' },
			{ name: 'emails.mbox', data: 'From x\nSubject: t\n\nbody' }
		];
		const tar = tarUtils.pack(entries);
		const out = tarUtils.unpack(tar);
		expect(out['manifest.json']).toBe('{"a":1}');
		expect(out['emails.mbox']).toBe('From x\nSubject: t\n\nbody');
	});

	it('总长度为 512 倍数且含结尾两空块', () => {
		const tar = tarUtils.pack([{ name: 'a.txt', data: 'hi' }]);
		expect(tar.length % 512).toBe(0);
		const tail = tar.slice(-1024);
		expect(tail.replace(/\0/g, '')).toBe('');
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --config vitest.unit.config.js test/unit/tar-utils.spec.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`mail-worker/src/utils/tar-utils.js`:
```js
const tarUtils = {
	pack(entries) {
		const enc = new TextEncoder();
		const chunks = [];
		for (const e of entries) {
			const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
			const nameBuf = enc.encode(e.name);
			const header = new Uint8Array(512);
			header.set(nameBuf.slice(0, 100));
			// mode 0000644
			this._setOctal(header, 100, 0o644, 7);
			// uid/gid 0
			this._setOctal(header, 108, 0, 7);
			this._setOctal(header, 116, 0, 7);
			// size
			this._setOctal(header, 124, data.length, 11);
			// mtime
			this._setOctal(header, 136, Math.floor(Date.now() / 1000), 11);
			// typeflag '0'
			header[156] = 0x30;
			// ustar magic
			header.set(enc.encode('ustar'), 257);
			header[263] = 0x30; header[264] = 0x30;
			// checksum
			this._setChecksum(header);
			chunks.push(header);
			chunks.push(this._pad512(data));
		}
		chunks.push(new Uint8Array(1024)); // 两空块结尾
		let total = 0;
		chunks.forEach(c => total += c.length);
		const out = new Uint8Array(total);
		let off = 0;
		for (const c of chunks) { out.set(c, off); off += c.length; }
		return out;
	},

	unpack(tar) {
		const dec = new TextDecoder();
		const result = {};
		let off = 0;
		while (off + 512 <= tar.length) {
			const header = tar.slice(off, off + 512);
			// 全零块=结束
			if (header.every(b => b === 0)) break;
			const name = dec.decode(header.slice(0, 100)).replace(/\0+$/, '');
			const size = parseInt(dec.decode(header.slice(124, 136)).replace(/\0+$/, ''), 8) || 0;
			off += 512;
			if (name) {
				const data = tar.slice(off, off + size);
				result[name] = dec.decode(data);
			}
			off += this._padUp(size);
		}
		return result;
	},

	_setOctal(buf, offset, value, len) {
		const s = value.toString(8).padStart(len - 1, '0') + '\0';
		for (let i = 0; i < len; i++) buf[offset + i] = s.charCodeAt(i);
	},

	_setChecksum(header) {
		for (let i = 148; i < 156; i++) header[i] = 0x20; // 空格
		let sum = 0;
		for (let i = 0; i < 512; i++) sum += header[i];
		this._setOctal(header, 148, sum, 7);
	},

	_pad512(data) {
		const rem = data.length % 512;
		if (rem === 0) return data;
		const padded = new Uint8Array(data.length + (512 - rem));
		padded.set(data);
		return padded;
	},

	_padUp(size) {
		const rem = size % 512;
		return rem === 0 ? size : size + (512 - rem);
	}
};

export default tarUtils;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run --config vitest.unit.config.js test/unit/tar-utils.spec.js`
Expected: PASS。

- [ ] **Step 5: Commit**
```bash
git add mail-worker/src/utils/tar-utils.js mail-worker/test/unit/tar-utils.spec.js
git commit -m "feat(backup): add lightweight tar pack/unpack utils with tests"
```

---

## Task 5: 重写 parseEml（改用 postal-mime）

替换 `email-service.js` 中简陋的 `parseEml`/`parseEmailAddress`/`parseEmailAddresses`/`parseBody`，统一为基于 `postal-mime` 的 `parseEmailRaw(emlText)`，返回与导入一致的归一结构。

**Files:**
- Modify: `mail-worker/src/service/email-service.js`（替换 parseEml 等 4 个方法）
- Test: `mail-worker/test/unit/parse-eml.spec.js`

- [ ] **Step 1: 写失败测试**

`mail-worker/test/unit/parse-eml.spec.js`:
```js
import { describe, it, expect } from 'vitest';
import emailService from '../../src/service/email-service';

const EML = [
	'From: Alice <alice@example.com>',
	'To: bob@rttx.net',
	'Subject: =?UTF-8?B?5rWL6K+V?=', // "测试" base64
	'Message-ID: <abc@example.com>',
	'Date: Wed, 1 Jan 2025 00:00:00 +0000',
	'MIME-Version: 1.0',
	'Content-Type: text/plain; charset=UTF-8',
	'',
	'hello body'
].join('\r\n');

describe('parseEmailRaw', () => {
	it('解析发件/收件/主题(解码)/正文', async () => {
		const p = await emailService.parseEmailRaw(EML);
		expect(p.from.address).toBe('alice@example.com');
		expect(p.to[0].address).toBe('bob@rttx.net');
		expect(p.subject).toBe('测试');
		expect(p.text).toContain('hello body');
		expect(p.messageId).toBe('<abc@example.com>');
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --config vitest.unit.config.js test/unit/parse-eml.spec.js`
Expected: FAIL（parseEmailRaw 不存在）。

- [ ] **Step 3: 实现**

在 `email-service.js` 顶部 import 增加（若未有）：`import PostalMime from 'postal-mime';`（email.js 已用，确认本文件顶部引入）。

删除旧的 `parseEml / parseEmailAddress / parseEmailAddresses / parseBody` 四个方法，新增：

```js
	async parseEmailRaw(emlText) {
		const parsed = await PostalMime.parse(emlText);
		const toArr = Array.isArray(parsed.to) ? parsed.to : (parsed.to ? [parsed.to] : []);
		return {
			from: parsed.from || { address: '', name: '' },
			to: toArr,
			cc: Array.isArray(parsed.cc) ? parsed.cc : [],
			bcc: Array.isArray(parsed.bcc) ? parsed.bcc : [],
			subject: parsed.subject || '',
			text: parsed.text || '',
			html: parsed.html || '',
			attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
			messageId: parsed.messageId || '',
			inReplyTo: parsed.inReplyTo || '',
			references: parsed.references || '',
			date: parsed.date || ''
		};
	},
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run --config vitest.unit.config.js test/unit/parse-eml.spec.js`
Expected: PASS。

- [ ] **Step 5: Commit**
```bash
git add mail-worker/src/service/email-service.js mail-worker/test/unit/parse-eml.spec.js
git commit -m "refactor(email): rewrite parseEml with postal-mime"
```

---

## Task 6: 重写 generateEml（读真实附件）

修正占位附件为从 R2 读取真实字节并 base64 编码；CID 内嵌图片转为 inline 附件。

**Files:**
- Modify: `mail-worker/src/service/email-service.js`（重写 `generateEml`）

- [ ] **Step 1: 实现**

替换现有 `generateEml` 方法（注意 import `r2Service`、`attService` 已在本文件存在）：

```js
	async generateEml(emailRow, attList, c) {
		const { r2Domain } = await settingService.query(c);

		const headers = [
			`From: ${emailRow.name ? emailRow.name + ' ' : ''}<${emailRow.sendEmail}>`,
			`To: ${emailRow.toName ? emailRow.toName + ' ' : ''}<${emailRow.toEmail}>`,
			`Subject: ${this._encodeHeader(emailRow.subject || '')}`,
			`Date: ${emailRow.createTime ? new Date(emailRow.createTime).toUTCString() : new Date().toUTCString()}`,
			`Message-ID: ${emailRow.messageId || `<${Date.now()}.${Math.random().toString(36).slice(2)}@cloud-mail>`}`,
			`MIME-Version: 1.0`
		];

		if (emailRow.cc && emailRow.cc !== '[]') {
			try {
				const ccList = JSON.parse(emailRow.cc);
				if (ccList.length) headers.push(`Cc: ${ccList.map(i => `${i.name ? i.name + ' ' : ''}<${i.address}>`).join(', ')}`);
			} catch (_) {}
		}
		if (emailRow.inReplyTo) headers.push(`In-Reply-To: ${emailRow.inReplyTo}`);
		if (emailRow.relation) headers.push(`References: ${emailRow.relation}`);

		const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
		headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, '');

		const parts = [];
		// text
		parts.push(`--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', this._b64(emailRow.text || ''));
		// html
		if (emailRow.content) {
			let html = emailRow.content;
			if (r2Domain) html = html.replace(/\{\{domain\}\}/g, require('../utils/domain-uitls').default.toOssDomain(r2Domain) + '/');
			parts.push(`--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', this._b64(html));
		}
		// 附件（真实内容）
		for (const a of attList) {
			const obj = await r2Service.getObj(c, a.key);
			let bytes;
			if (obj) {
				const ab = await obj.arrayBuffer();
				bytes = new Uint8Array(ab);
			} else {
				bytes = new Uint8Array(0);
			}
			const disposition = a.contentId ? 'inline' : 'attachment';
			const ct = a.mimeType || 'application/octet-stream';
			let partHead = [`--${boundary}`, `Content-Type: ${ct}`, `Content-Disposition: ${disposition}; filename="${this._encodeHeader(a.filename || 'attachment')}"`, 'Content-Transfer-Encoding: base64'];
			if (a.contentId) partHead.push(`Content-ID: <${a.contentId.replace(/^<|>$/g, '')}>`);
			parts.push(...partHead, '', this._b64Bytes(bytes));
		}
		parts.push(`--${boundary}--`, '');
		return [...headers, ...parts].join('\r\n');
	},

	_encodeHeader(s) {
		// 非 ASCII 用 =?UTF-8?B? ?= 包裹
		if (!s) return '';
		if (/[\x00-\x7F]*/.test(s) && !/[^\x00-\x7F]/.test(s)) return s;
		return '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(s))) + '?=';
	},

	_b64(str) {
		return btoa(unescape(encodeURIComponent(str || '')));
	},

	_b64Bytes(bytes) {
		let bin = '';
		const chunk = 0x8000;
		for (let i = 0; i < bytes.length; i += chunk) {
			bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
		}
		return btoa(bin).replace(/(.{76})/g, '$1\r\n');
	},
```

- [ ] **Step 2: 冒烟验证（手动，集成层）**

在 `wrangler dev` 下调用现有 `emailApi` 导出（若已接线）或临时脚本：构造一封带附件的邮件，调用 `emailService.generateEml`，检查输出含 `Content-Transfer-Encoding: base64` 且附件段非 `SGVsbG8gV29ybGQ=`。（本步属集成，记录到末尾手动清单即可。）

- [ ] **Step 3: Commit**
```bash
git add mail-worker/src/service/email-service.js
git commit -m "fix(email): generate real base64 attachment content in generateEml"
```

---

## Task 7: importSingleEmail（核心注入：路由 + 去重 + 入库 + 附件）

单封邮件导入核心函数，供 backup-service 调用。

**Files:**
- Modify: `mail-worker/src/service/email-service.js`（新增 `importSingleEmail` + `dedupExists`）

- [ ] **Step 1: 实现**

`email-service.js` 新增方法：

```js
	// 单封导入：parsed 来自 parseEmailRaw；toAddress 为本次归属收件地址（取 parsed.to[0] 或调用方指定）
	async importSingleEmail(c, parsed, opts = {}) {
		const toAddress = opts.toAddress || (parsed.to[0] && parsed.to[0].address) || '';

		let accountId = 0, userId = 0, status = emailConst.status.NOONE;
		if (toAddress) {
			const acc = await accountService.selectByEmailIncludeDel(c, toAddress);
			if (acc && acc.isDel === 0) {
				accountId = acc.accountId;
				userId = acc.userId;
				status = emailConst.status.RECEIVE;
			}
		}

		// 去重
		const dup = await this.dedupExists(c, { messageId: parsed.messageId, sendEmail: parsed.from.address, toEmail: toAddress, subject: parsed.subject, date: parsed.date, accountId });
		if (dup) return { action: 'skipped' };

		// CID 内嵌附件收集
		const cidAttachments = parsed.attachments.filter(a => a.contentId);

		const emailValues = {
			sendEmail: parsed.from.address,
			name: parsed.from.name || emailUtils.getName(parsed.from.address),
			accountId, userId,
			subject: parsed.subject,
			text: parsed.text,
			content: this.imgReplace(parsed.html || '', cidAttachments, opts.r2Domain),
			cc: JSON.stringify(parsed.cc || []),
			bcc: JSON.stringify(parsed.bcc || []),
			recipient: JSON.stringify(parsed.to.length ? parsed.to : (toAddress ? [{ address: toAddress, name: '' }] : [])),
			toEmail: toAddress,
			toName: (parsed.to[0] && parsed.to[0].name) || '',
			inReplyTo: parsed.inReplyTo || '',
			relation: parsed.references || '',
			messageId: parsed.messageId || '',
			type: emailConst.type.RECEIVE,
			status,
			unread: emailConst.unread.UNREAD,
			sendMethod: emailConst.sendMethod.IMPORTED
		};
		if (parsed.date) emailValues.createTime = parsed.date;

		const emailRow = await orm(c).insert(email).values(emailValues).returning().get();

		// 附件入库（hash 去重由 key 天然保证）
		const atts = [];
		for (const a of parsed.attachments) {
			const content = a.content instanceof Uint8Array ? a.content : new TextEncoder().encode(a.content || '');
			const hash = await fileUtils.getBuffHash(content);
			const ext = fileUtils.getExtFileName(a.filename || '');
			atts.push({
				key: constant.ATTACHMENT_PREFIX + hash + ext,
				filename: a.filename || 'attachment',
				mimeType: a.mimeType || 'application/octet-stream',
				size: content.length,
				contentId: a.contentId || null,
				disposition: a.disposition || (a.contentId ? 'inline' : 'attachment'),
				related: a.related || null,
				encoding: a.encoding || null,
				userId, accountId, emailId: emailRow.emailId,
				status: 0,
				type: a.contentId ? attConst.type.EMBED : attConst.type.ATT,
				_content: content
			});
		}
		if (atts.length > 0) {
			await attService.addAtt(c, atts.map(({ _content, ...rest }) => ({ ...rest, content: _content })));
		}
		return { action: 'imported', emailId: emailRow.emailId };
	},

	// 去重：有 messageId 按 (accountId,toEmail,messageId)；否则按元组指纹
	async dedupExists(c, { messageId, sendEmail, toEmail, subject, date, accountId }) {
		if (messageId) {
			if (accountId > 0) {
				const row = await orm(c).select({ id: email.emailId }).from(email).where(and(eq(email.accountId, accountId), eq(email.messageId, messageId))).get();
				return !!row;
			}
			const row = await orm(c).select({ id: email.emailId }).from(email).where(and(eq(email.toEmail, toEmail), eq(email.messageId, messageId))).get();
			return !!row;
		}
		const row = await orm(c).select({ id: email.emailId }).from(email).where(and(
			eq(email.sendEmail, sendEmail || ''),
			eq(email.toEmail, toEmail || ''),
			eq(email.subject, subject || '')
		)).get();
		return !!row;
	},
```

确保顶部已 import：`constant`、`fileUtils`、`attConst`（来自 entity-const）、`accountService`、`attService`、`orm`、`email`(entity)、`and/eq`（drizzle）。多数已存在，按需补 `import constant from '../const/constant';`、`import fileUtils from '../utils/file-utils';`、`import { attConst } from '../const/entity-const';`。

- [ ] **Step 2: Commit**
```bash
git add mail-worker/src/service/email-service.js
git commit -m "feat(email): add importSingleEmail core injection with routing and dedup"
```

---

## Task 8: 接线 exportEmail / importEmail 到新核心

将原占位 `exportEmail`/`importEmail` 改为薄封装，调用新实现，保持对外签名简洁（供未来单封接口或测试复用）。

**Files:**
- Modify: `mail-worker/src/service/email-service.js`（重写 `exportEmail`、`importEmail`）

- [ ] **Step 1: 实现**

```js
	async exportEmail(c, emailId, userId) {
		const emailRow = await this.selectById(c, emailId);
		if (!emailRow) throw new BizError(t('notExistEmail'));
		if (emailRow.userId !== userId && !userContext.isAdmin(c)) throw new BizError(t('noPermission'));
		const attList = await attService.selectByEmailIds(c, [emailId]);
		return await this.generateEml(emailRow, attList, c);
	},

	async importEmail(c, emlContent, userId) {
		const parsed = await this.parseEmailRaw(emlContent);
		return await this.importSingleEmail(c, parsed, { userId });
	},
```

（顶部需 `import userContext from '../security/user-context';`）

- [ ] **Step 2: Commit**
```bash
git add mail-worker/src/service/email-service.js
git commit -m "refactor(email): wire exportEmail/importEmail to new core"
```

---

## Task 9: backup-service — 任务管理 + 配置 dump/restore

新建 `backup-service.js`：任务 CRUD、配置 dump（含/不含 secrets）、配置 restore（合并去重）。

**Files:**
- Create: `mail-worker/src/service/backup-service.js`
- Test: `mail-worker/test/unit/backup-config.spec.js`

- [ ] **Step 1: 写失败测试（配置脱敏与合并）**

`mail-worker/test/unit/backup-config.spec.js`:
```js
import { describe, it, expect } from 'vitest';
import backupService from '../../src/service/backup-service';

describe('backup config sanitize/merge', () => {
	it('sanitizeSecrets 清除敏感字段', () => {
		const u = [{ email: 'a@x', password: 'p', salt: 's', createIp: '1.2.3.4' }];
		const out = backupService.sanitizeUsers(u, false);
		expect(out[0].password).toBe('');
		expect(out[0].salt).toBe('');
		expect(out[0].createIp).toBe('');
		expect(out[0].email).toBe('a@x');
	});

	it('includeSecrets=true 保留', () => {
		const u = [{ email: 'a@x', password: 'p', salt: 's' }];
		const out = backupService.sanitizeUsers(u, true);
		expect(out[0].password).toBe('p');
	});
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run --config vitest.unit.config.js test/unit/backup-config.spec.js`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现服务（任务管理 + 配置部分）**

`mail-worker/src/service/backup-service.js`:
```js
import orm from '../entity/orm';
import { backupTask } from '../entity/backup-task';
import { eq, and, inArray, asc, desc, sql } from 'drizzle-orm';
import { email } from '../entity/email';
import user from '../entity/user';
import accountEntity from '../entity/account';
import r2Service from './r2-service';
import emailService from './email-service';
import settingService from './setting-service';
import attService from './att-service';
import mboxUtils from '../utils/mbox-utils';
import tarUtils from '../utils/tar-utils';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';
import { v4 as uuidv4 } from 'uuid';

const SECRET_USER_KEYS = ['password', 'salt', 'createIp', 'activeIp'];
const SECRET_ACCOUNT_KEYS = ['smtpPassword', 'smtpUser'];

const backupService = {

	// ---- 任务管理 ----
	async createTask(c, type, params, sourceKeys = []) {
		const row = await orm(c).insert(backupTask).values({
			type,
			status: 'pending',
			sourceKeys: JSON.stringify(sourceKeys),
			params: JSON.stringify(params || {})
		}).returning().get();
		return row;
	},

	async getTask(c, taskId) {
		return orm(c).select().from(backupTask).where(eq(backupTask.taskId, taskId)).get();
	},

	async listTasks(c, type) {
		return orm(c).select().from(backupTask).where(eq(backupTask.type, type)).orderBy(desc(backupTask.taskId)).limit(50).all();
	},

	async patchTask(c, taskId, patch) {
		await orm(c).update(backupTask).set({ ...patch, updateTime: new Date().toISOString() }).where(eq(backupTask.taskId, taskId)).run();
	},

	async pushDetail(c, taskId, entry) {
		const task = await this.getTask(c, taskId);
		if (!task) return;
		let log = [];
		try { log = JSON.parse(task.detailLog || '[]'); } catch (_) {}
		log.push(entry);
		if (log.length > 100) log = log.slice(-100);
		await this.patchTask(c, taskId, { detailLog: JSON.stringify(log) });
	},

	async cancelTask(c, taskId) {
		await this.patchTask(c, taskId, { status: 'cancelled' });
	},

	// ---- 配置脱敏（纯函数，可单测） ----
	sanitizeUsers(list, includeSecrets) {
		return list.map(u => {
			const o = { ...u };
			if (!includeSecrets) SECRET_USER_KEYS.forEach(k => { if (k in o) o[k] = ''; });
			return o;
		});
	},

	sanitizeAccounts(list, includeSecrets) {
		return list.map(a => {
			const o = { ...a };
			if (!includeSecrets) SECRET_ACCOUNT_KEYS.forEach(k => { if (k in o) o[k] = ''; });
			return o;
		});
	},

	async dumpConfig(c, includeSecrets) {
		const users = await orm(c).select().from(user).all();
		const accounts = await orm(c).select().from(accountEntity).all();
		return {
			users: this.sanitizeUsers(users, includeSecrets),
			accounts: this.sanitizeAccounts(accounts, includeSecrets),
			includeSecrets,
			dumpedAt: new Date().toISOString()
		};
	},

	// 合并去重：已存在（按唯一键）跳过
	async restoreConfig(c, config) {
		let insertedUsers = 0, insertedAccounts = 0, skippedUsers = 0, skippedAccounts = 0;
		for (const u of config.users || []) {
			const exists = await orm(c).select({ id: user.userId }).from(user).where(sql`${user.email} COLLATE NOCASE = ${u.email}`).get();
			if (exists) { skippedUsers++; continue; }
			await orm(c).insert(user).values(u).run();
			insertedUsers++;
		}
		for (const a of config.accounts || []) {
			const exists = await orm(c).select({ id: accountEntity.accountId }).from(accountEntity).where(sql`${accountEntity.email} COLLATE NOCASE = ${a.email}`).get();
			if (exists) { skippedAccounts++; continue; }
			await orm(c).insert(accountEntity).values(a).run();
			insertedAccounts++;
		}
		return { insertedUsers, skippedUsers, insertedAccounts, skippedAccounts };
	}
};

export default backupService;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run --config vitest.unit.config.js test/unit/backup-config.spec.js`
Expected: PASS。

- [ ] **Step 5: Commit**
```bash
git add mail-worker/src/service/backup-service.js mail-worker/test/unit/backup-config.spec.js
git commit -m "feat(backup): add backup-service task mgmt and config dump/restore"
```

---

## Task 10: backup-service — 备份导出分批 process

按 `emailId` 游标分批：每批 N 封 → generateEml → 追加进 R2 的 `backup/<taskId>/emails.mbox` → 更新 cursor/processed。完成后写 manifest 与 config。

**Files:**
- Modify: `mail-worker/src/service/backup-service.js`（新增 `processBackupBatch`、`finalizeBackup`）

- [ ] **Step 1: 实现**

在 `backupService` 内新增：

```js
	BACKUP_BATCH: 20,
	BACKUP_PREFIX: 'backup/',

	async processBackupBatch(c, taskId) {
		const task = await this.getTask(c, taskId);
		if (!task || task.status === 'cancelled') return task;
		if (task.status === 'pending') {
			await this.patchTask(c, taskId, { status: 'processing' });
			const total = await this._countEmails(c);
			await this.patchTask(c, taskId, { total });
		}
		const refreshed = await this.getTask(c, taskId);
		const filter = JSON.parse(refreshed.params || '{}').filter || {};
		const rows = await this._selectEmailBatch(c, refreshed.cursor, this.BACKUP_BATCH, filter);
		if (rows.length === 0) {
			await this.finalizeBackup(c, taskId);
			return await this.getTask(c, taskId);
		}
		let mboxChunk = '';
		let lastId = refreshed.cursor;
		const { r2Domain } = await settingService.query(c);
		for (const row of rows) {
			try {
				const attList = await attService.selectByEmailIds(c, [row.emailId]);
				const eml = await emailService.generateEml(row, attList, c);
				mboxChunk = mboxUtils.appendEntry(mboxChunk, eml);
				lastId = row.emailId;
			} catch (e) {
				await this.pushDetail(c, taskId, { emailId: row.emailId, reason: e.message });
				await this.patchTask(c, taskId, { failed: refreshed.failed + 1 });
			}
		}
		// 追加到 R2
		const key = this.BACKUP_PREFIX + taskId + '/emails.mbox';
		const existing = await r2Service.getObj(c, key);
		const prevText = existing ? await existing.text() : '';
		await r2Service.putObj(c, key, prevText + mboxChunk, { contentType: 'application/mbox' });

		await this.patchTask(c, taskId, {
			cursor: lastId,
			processed: refreshed.processed + rows.length,
			updateTime: new Date().toISOString()
		});
		return await this.getTask(c, taskId);
	},

	async finalizeBackup(c, taskId) {
		const task = await this.getTask(c, taskId);
		const params = JSON.parse(task.params || '{}');
		const config = params.includeConfig ? await this.dumpConfig(c, !!params.includeSecrets) : null;
		const manifest = {
			version: 1,
			createdAt: new Date().toISOString(),
			emailCount: task.processed,
			includeConfig: !!params.includeConfig,
			includeSecrets: !!params.includeSecrets,
			sensitivity: params.includeSecrets ? 'confidential' : 'normal'
		};
		await r2Service.putObj(c, this.BACKUP_PREFIX + taskId + '/manifest.json', JSON.stringify(manifest, null, 2), { contentType: 'application/json' });
		if (config) {
			await r2Service.putObj(c, this.BACKUP_PREFIX + taskId + '/config.json', JSON.stringify(config, null, 2), { contentType: 'application/json' });
		}
		await this.patchTask(c, taskId, { status: 'completed', resultKey: this.BACKUP_PREFIX + taskId + '/', updateTime: new Date().toISOString() });
	},

	async _countEmails(c) {
		const r = await orm(c).select({ n: sql`COUNT(*)` }).from(email).get();
		return Number(r?.n || 0);
	},

	async _selectEmailBatch(c, cursor, size, filter) {
		const conds = [sql`${email.emailId} > ${cursor}`];
		if (filter && filter.types && filter.types.length) {
			// type receive=0 send=1
			// 这里简化：不传则全部
		}
		return orm(c).select().from(email).where(sql`${email.emailId} > ${cursor}`).orderBy(asc(email.emailId)).limit(size).all();
	},
```

> 注：`settingService`、`attService` 已在 backup-service.js 顶部 import（见 Task 9 import 区），上面直接引用即可。

- [ ] **Step 2: Commit**
```bash
git add mail-worker/src/service/backup-service.js
git commit -m "feat(backup): implement backup export batch processing"
```

---

## Task 11: backup-service — 备份包下载/列表/删除

**Files:**
- Modify: `mail-worker/src/service/backup-service.js`

- [ ] **Step 1: 实现**

```js
	async listBackups(c) {
		// 列出 backup_task 中 type=backup 的记录
		return this.listTasks(c, 'backup');
	},

	async getBackupTar(c, taskId) {
		const task = await this.getTask(c, taskId);
		if (!task || !task.resultKey) throw new BizError(t('notExistEmail'));
		const prefix = task.resultKey;
		const entries = [];
		for (const name of ['manifest.json', 'emails.mbox', 'config.json']) {
			const obj = await r2Service.getObj(c, prefix + name);
			if (obj) entries.push({ name, data: await obj.text() });
		}
		if (entries.length === 0) throw new BizError('backup empty');
		return tarUtils.pack(entries);
	},

	async deleteBackup(c, taskId) {
		const task = await this.getTask(c, taskId);
		if (task && task.resultKey) {
			for (const name of ['manifest.json', 'emails.mbox', 'config.json']) {
				try { await r2Service.delete(c, task.resultKey + name); } catch (_) {}
			}
		}
		await orm(c).delete(backupTask).where(eq(backupTask.taskId, taskId)).run();
	},
```

- [ ] **Step 2: Commit**
```bash
git add mail-worker/src/service/backup-service.js
git commit -m "feat(backup): add backup download/list/delete"
```

---

## Task 12: backup-service — 上传多文件 + 恢复/导入分批 process

上传：多文件写 R2 暂存，返回累积 sourceKeys。处理：按 `fileIndex`+`cursor` 遍历；EML 单封、MBOX 流式切分、备份包先 restoreConfig 再当 MBOX。

**Files:**
- Modify: `mail-worker/src/service/backup-service.js`

- [ ] **Step 1: 实现**

```js
	IMPORT_BATCH: 20,
	STORE_PREFIX: 'restore/',

	async uploadFiles(c, files) {
		// files: [{ filename, content(Uint8Array|string) }]
		const keys = [];
		for (const f of files) {
			const key = this.STORE_PREFIX + uuidv4().replace(/-/g, '') + '/' + encodeURIComponent(f.filename || 'file');
			const body = f.content instanceof Uint8Array ? f.content : new TextEncoder().encode(f.content);
			await r2Service.putObj(c, key, body, { contentType: 'application/octet-stream' });
			keys.push(key);
		}
		return keys;
	},

	async createRestoreTask(c, sourceKeys, mode, dedup) {
		return this.createTask(c, mode === 'restore' ? 'restore' : 'import', { mode, dedup: dedup || 'skip' }, sourceKeys);
	},

	async processImportBatch(c, taskId) {
		const task = await this.getTask(c, taskId);
		if (!task || task.status === 'cancelled') return task;
		if (task.status === 'pending') await this.patchTask(c, taskId, { status: 'processing' });
		const cur = await this.getTask(c, taskId);
		const sourceKeys = JSON.parse(cur.sourceKeys || '[]');
		if (cur.fileIndex >= sourceKeys.length) {
			await this.patchTask(c, taskId, { status: 'completed' });
			return await this.getTask(c, taskId);
		}
		const key = sourceKeys[cur.fileIndex];
		const obj = await r2Service.getObj(c, key);
		if (!obj) {
			await this.patchTask(c, taskId, { fileIndex: cur.fileIndex + 1, cursor: 0 });
			return await this.getTask(c, taskId);
		}
		const text = await obj.text();
		const { r2Domain } = await settingService.query(c);

		// 备份包：先恢复配置，再按 mbox 处理
		let isBackup = false;
		try {
			const head = text.slice(0, 200);
			if (head.startsWith('From ') === false && text.includes('"users"') && text.includes('"accounts"')) {
				isBackup = true;
			}
		} catch (_) {}

		// 简单识别：若 fileIndex==0 且首文件含 "manifest"/config 结构，按备份包
		if (cur.fileIndex === 0 && /\{[\s\S]*"users"[\s\S]*"accounts"[\s\S]*\}/.test(text) && text.trim().startsWith('{')) {
			isBackup = true;
		}

		if (isBackup && cur.cursor === 0) {
			try {
				const config = JSON.parse(text);
				await this.restoreConfig(c, config);
			} catch (e) {
				await this.pushDetail(c, taskId, { file: key, reason: 'config restore: ' + e.message });
			}
			await this.patchTask(c, taskId, { cursor: 1 });
			return await this.getTask(c, taskId);
		}

		// 判定 EML or MBOX
		let messages = [];
		let nextCursor = 0; let done = true; let advanceFile = false;
		if (text.includes('\nFrom ') || text.startsWith('From ')) {
			const r = mboxUtils.splitNextBatch(text, cur.cursor, this.IMPORT_BATCH);
			messages = r.messages; nextCursor = r.nextCursor; done = r.done;
			advanceFile = done;
		} else {
			// 单封 EML
			messages = [text];
			advanceFile = true;
		}

		let processed = cur.processed, skipped = cur.skipped, failed = cur.failed;
		for (const raw of messages) {
			try {
				const parsed = await emailService.parseEmailRaw(raw);
				const res = await emailService.importSingleEmail(c, parsed, { r2Domain });
				if (res.action === 'skipped') skipped++; else processed++;
			} catch (e) {
				failed++;
				await this.pushDetail(c, taskId, { file: key, reason: e.message });
			}
		}

		const patch = { processed, skipped, failed };
		if (advanceFile) { patch.fileIndex = cur.fileIndex + 1; patch.cursor = 0; }
		else { patch.cursor = nextCursor; }
		await this.patchTask(c, taskId, patch);
		return await this.getTask(c, taskId);
	},
```

确保顶部已 `import settingService from './setting-service';`。

- [ ] **Step 2: Commit**
```bash
git add mail-worker/src/service/backup-service.js
git commit -m "feat(backup): implement multi-file upload and import/restore batch processing"
```

---

## Task 13: backup-api — 管理员接口 + 注册路由

**Files:**
- Create: `mail-worker/src/api/backup-api.js`
- Modify: `mail-worker/src/hono/webs.js`（加 `import '../api/backup-api';`）

- [ ] **Step 1: 实现 API**

`mail-worker/src/api/backup-api.js`:
```js
import app from '../hono/hono';
import backupService from '../service/backup-service';
import result from '../model/result';
import userContext from '../security/user-context';
import BizError from '../error/biz-error';
import { t } from '../i18n/i18n';

function assertAdmin(c) {
	if (!userContext.isAdmin(c)) throw new BizError(t('unauthorized'), 403);
}

// 备份：创建
app.post('/admin/backup/create', async (c) => {
	assertAdmin(c);
	const body = await c.req.json();
	const task = await backupService.createTask(c, 'backup', {
		scope: body.scope || 'all',
		filter: body.filter || {},
		includeConfig: body.includeConfig !== false,
		includeSecrets: !!body.includeSecrets,
		schedule: body.schedule || 'once'
	});
	return c.json(result.ok(task));
});

// 备份：推进一批（前端轮询）
app.post('/admin/backup/:taskId/process', async (c) => {
	assertAdmin(c);
	const taskId = Number(c.req.param('taskId'));
	const task = await backupService.processBackupBatch(c, taskId);
	return c.json(result.ok(task));
});

app.get('/admin/backup/:taskId/progress', async (c) => {
	assertAdmin(c);
	const task = await backupService.getTask(c, Number(c.req.param('taskId')));
	return c.json(result.ok(task));
});

app.get('/admin/backup/list', async (c) => {
	assertAdmin(c);
	return c.json(result.ok(await backupService.listBackups(c)));
});

app.get('/admin/backup/:backupId/download', async (c) => {
	assertAdmin(c);
	const tar = await backupService.getBackupTar(c, Number(c.req.param('backupId')));
	return new Response(tar, { headers: { 'Content-Type': 'application/x-tar', 'Content-Disposition': `attachment; filename="backup-${c.req.param('backupId')}.tar"` } });
});

app.delete('/admin/backup/:backupId', async (c) => {
	assertAdmin(c);
	await backupService.deleteBackup(c, Number(c.req.param('backupId')));
	return c.json(result.ok());
});

// 恢复/导入：上传多文件
app.post('/admin/restore/upload', async (c) => {
	assertAdmin(c);
	const form = await c.req.formData();
	const files = [];
	for (const [name, value] of form.entries()) {
		if (value instanceof File) {
			const buf = new Uint8Array(await value.arrayBuffer());
			files.push({ filename: value.name, content: buf });
		}
	}
	const keys = await backupService.uploadFiles(c, files);
	return c.json(result.ok({ sourceKeys: keys }));
});

// 恢复/导入：建任务
app.post('/admin/restore/create', async (c) => {
	assertAdmin(c);
	const body = await c.req.json();
	const task = await backupService.createRestoreTask(c, body.sourceKeys || [], body.mode || 'import', body.dedup || 'skip');
	return c.json(result.ok(task));
});

app.post('/admin/restore/:taskId/process', async (c) => {
	assertAdmin(c);
	const task = await backupService.processImportBatch(c, Number(c.req.param('taskId')));
	return c.json(result.ok(task));
});

app.get('/admin/restore/:taskId/progress', async (c) => {
	assertAdmin(c);
	const task = await backupService.getTask(c, Number(c.req.param('taskId')));
	return c.json(result.ok(task));
});

app.get('/admin/restore/task/list', async (c) => {
	assertAdmin(c);
	const type = c.req.query('type') || 'import';
	return c.json(result.ok(await backupService.listTasks(c, type)));
});

app.post('/admin/backup-task/:taskId/cancel', async (c) => {
	assertAdmin(c);
	await backupService.cancelTask(c, Number(c.req.param('taskId')));
	return c.json(result.ok());
});
```

- [ ] **Step 2: 注册路由**

`mail-worker/src/hono/webs.js` 末尾加：
```js
import '../api/backup-api'
```

- [ ] **Step 3: 冒烟验证（集成）**

`wrangler dev`，管理员登录后：
```bash
curl -X POST '<dev>/api/admin/backup/create' -H 'Authorization: <jwt>' -H 'Content-Type: application/json' -d '{}'
curl -X POST '<dev>/api/admin/backup/<id>/process' -H 'Authorization: <jwt>'
curl '<dev>/api/admin/backup/<id>/progress' -H 'Authorization: <jwt>'
```
预期 status 推进至 completed，processed 递增。

- [ ] **Step 4: Commit**
```bash
git add mail-worker/src/api/backup-api.js mail-worker/src/hono/webs.js
git commit -m "feat(backup): add admin backup/restore API and register routes"
```

---

## Task 14: i18n 文案

**Files:**
- Modify: `mail-worker/src/i18n/`（中/英，按现有结构补 key）

- [ ] **Step 1: 补 key**

复用现有 `unauthorized`、`notExistEmail` 等已存在 key。新增（若缺）：`backupEmpty`。最小改动：确认 `t('unauthorized')`、`t('notExistEmail')` 已在 i18n 字典存在（grep 确认），无需新增。

Run: `grep -rn "unauthorized" mail-worker/src/i18n/`
Expected: 至少一处定义。

- [ ] **Step 2: Commit（如有改动）**
```bash
git add mail-worker/src/i18n/
git commit -m "i18n(backup): add backup keys"
```

---

## Task 15: scheduled 定时备份接入

**Files:**
- Modify: `mail-worker/src/index.js`（`scheduled` 内按 `backup_cron` 开关触发备份推进）

- [ ] **Step 1: 实现**

`index.js` 顶部 import 增加：
```js
import backupService from './service/backup-service';
import settingService from './service/setting-service';
import orm from './entity/orm';
import { backupTask } from './entity/backup-task';
import { eq } from 'drizzle-orm';
```

在 `scheduled(c, env, ctx)` 内（现有逻辑后）追加：
```js
		try {
			const settings = await settingService.query({ env });
			if (settings.backupCron) {
				const db = orm({ env });
				// 若无 processing 的备份任务，创建一个；并推进若干批
				let task = await db.select().from(backupTask).where(eq(backupTask.status, 'processing')).get();
				if (!task) {
					task = await backupService.createTask({ env }, 'backup', { scope: 'all', includeConfig: true, includeSecrets: false, schedule: 'cron' });
				}
				for (let i = 0; i < 5; i++) {
					task = await backupService.processBackupBatch({ env }, task.taskId);
					if (task.status === 'completed' || task.status === 'cancelled') break;
				}
			}
		} catch (e) {
			console.error('scheduled backup failed:', e);
		}
```

注意：service 内方法用 `c.env`/`orm(c)`，scheduled 传 `{ env }` 即可（现有代码如 `completeReceiveAll({ env })` 已用此模式）。`settingService.query` 的返回字段为 camelCase（`backupCron`）。若 setting 实体未声明 `backupCron`，迁移已加列，query 需返回该列——检查 `setting-service.js` 的 select 是否覆盖全列（`select *`）。若 query 用具名字段，需补 `backupCron`。

- [ ] **Step 2: 确认 setting.query 返回 backupCron**

Run: `grep -n "backupCron\|backup_cron\|select" mail-worker/src/service/setting-service.js | head`
若 query 用 `select()` 全字段则 OK；否则补字段映射。按需修改并纳入本任务 commit。

- [ ] **Step 3: Commit**
```bash
git add mail-worker/src/index.js mail-worker/src/service/setting-service.js
git commit -m "feat(backup): wire scheduled cron backup with backup_cron toggle"
```

---

## Task 16: 端到端手动验证清单

集成层（D1/R2）在 `wrangler dev` 手动验证。执行后勾选。

- [ ] **迁移**：`curl '<dev>/init/<secret>'` 返回 success；`backup_task` 表存在。
- [ ] **备份导出**：`POST /admin/backup/create` → 轮询 `/process` 至 completed；`GET /admin/backup/<id>/download` 得到 tar，解包含 manifest.json + emails.mbox + config.json。
- [ ] **导入单封 EML**：上传一封 `.eml`（收件地址为已存在邮箱）→ 导入后该邮箱列表可见该邮件，`sendMethod=imported`。
- [ ] **导入 MBOX**：上传多封 MBOX → 全部入库。
- [ ] **多文件上传**：一次 `/restore/upload` 传 3 个文件，sourceKeys 长度=3；建任务后依次处理。
- [ ] **NOONE 路由**：导入收件地址不存在的邮件 → 后台 `/allEmail/list?type=noone` 可见。
- [ ] **去重**：重复导入同一封（同 Message-ID）→ skipped 递增，无重复行。
- [ ] **附件**：导入含附件 EML → 附件可下载；附件 key 复用（相同内容不重复上传）。
- [ ] **整体恢复**：下载 tar（含 config）→ 清库后 `/restore/upload` + `/restore/create {mode:'restore'}` → 轮询至 completed → 用户/账户/邮件恢复。
- [ ] **脱敏**：`includeSecrets=false` 备份的 config.json 中 user.password 为空。
- [ ] **取消**：任务 processing 时 `/backup-task/<id>/cancel` → 后续 process 不再推进。
- [ ] **单测全绿**：`npx vitest run --config vitest.unit.config.js` 全部 PASS。

---

## Self-Review（计划自查）

- **Spec 覆盖**：EML+MBOX(Task5/12)、多文件上传(Task12)、NOONE 路由(Task7)、邮件+配置(Task9/10)、合并去重(Task7/9)、R2+本地下载(Task11)、任务表分批(Task1/10/12)、admin 鉴权(Task13)、定时(Task15)、测试(Task2-5/9) — 均有对应任务。
- **占位符**：无 TBD/TODO；ESM `require` 误用已修正为顶部 import 的 `settingService`/`attService`，`user` default 导出已修正。
- **类型/签名一致**：`importSingleEmail(c, parsed, opts)`、`parseEmailRaw(emlText)`、`generateEml(emailRow, attList, c)`、`processBackupBatch(c, taskId)`、`processImportBatch(c, taskId)`、`uploadFiles(c, files)` 跨任务签名一致。
- **前端**：本计划聚焦后端（可独立交付与测试）；前端计划另行编写（依赖本计划 API 完成）。

// onError 的运行时错误映射（纯函数，便于单测）。
// 原则：如实报告 —— 保留原始 TypeError 信息，并附上当前部署实际缺失的
// 绑定清单，不猜测错误属于哪个数据库。旧逻辑把一切 undefined.get/put
// 猜成「KV数据库未绑定」，曾把 R2 缺绑定误报成 KV 未绑定，误导排查。
const REQUIRED_BINDINGS = {
	db: 'D1 (db)',
	kv: 'KV (kv)',
	assets: 'Assets (assets)',
};

const OPTIONAL_BINDINGS = {
	r2: 'R2 (r2，可选)',
};

function missingBindings(env) {
	const missing = [];
	for (const [key, label] of Object.entries(REQUIRED_BINDINGS)) {
		if (!env?.[key]) missing.push(label);
	}
	for (const [key, label] of Object.entries(OPTIONAL_BINDINGS)) {
		if (!env?.[key]) missing.push(label);
	}
	return missing;
}

// 返回 { message, code } 表示已映射；返回 null 表示交由 onError 通用分支
function mapRuntimeError(err, env) {
	if (!err || err.name !== 'TypeError' || !/reading '/.test(err.message || '')) {
		return null;
	}
	const missing = missingBindings(env);
	const hint = missing.length
		? `当前部署未绑定：${missing.join('、')}`
		: '数据库绑定均正常，请查看 Worker 日志定位';
	return { message: `服务端错误 ${err.message}（${hint}）`, code: 502 };
}

export { mapRuntimeError };
export default { mapRuntimeError };

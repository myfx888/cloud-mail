// 缓存头治理中间件 —— 参照 portal 的 noCacheHeaders 经验
// 动态 email 路由用双头（浏览器 + EdgeOne），正文/附件走长缓存

const NO_STORE = 'no-store, no-cache, must-revalidate';
const LONG_CACHE = 'public, max-age=604800, immutable';

// 中间件：对所有匹配路由注入 no-store 双头（浏览器 + cdn）
function noCacheHeaders(c, next) {
	c.header('Cache-Control', NO_STORE);
	c.header('cdn-cache-control', 'no-store');
	return next();
}

// 辅助函数：给正文/附件的 200 响应注入长缓存头
function longCacheHeaders(c) {
	c.header('Cache-Control', LONG_CACHE);
	c.header('cdn-cache-control', `public, max-age=604800`);
}

// 辅助函数：给错误响应（404/403）注入 no-store，避免错误被边缘缓存
function noStoreHeaders(c) {
	c.header('Cache-Control', NO_STORE);
	c.header('cdn-cache-control', 'no-store');
}

export { noCacheHeaders, longCacheHeaders, noStoreHeaders };

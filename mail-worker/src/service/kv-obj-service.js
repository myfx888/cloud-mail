const kvObjService = {

	async putObj(c, key, content, metadata) {
		if (c.env.kv && c.env.kv.put) {
			await c.env.kv.put(key, content, { metadata: metadata });
		} else {
			throw new BizError('KV storage not available');
		}
	},

	async deleteObj(c, keys) {

		if (typeof keys === 'string') {
			keys = [keys];
		}

		if (keys.length === 0) {
			return;
		}

		if (c.env.kv && c.env.kv.delete) {
			await Promise.all(keys.map( key => c.env.kv.delete(key)));
		} else {
			throw new BizError('KV storage not available');
		}
	},

	async toObjResp(c, key) {

		if (!c.env.kv || !c.env.kv.getWithMetadata) {
			throw new BizError('KV storage not available');
		}
		const obj = await c.env.kv.getWithMetadata(key, { type: "arrayBuffer"});

		return new Response(obj.value, {
			headers: {
				'Content-Type': obj.metadata?.contentType || 'application/octet-stream',
				'Content-Disposition': obj.metadata?.contentDisposition || null,
				'Cache-Control': obj.metadata?.cacheControl || null
			}
		});

	}

};

export default kvObjService;

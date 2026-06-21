const mboxUtils = {

	appendEntry(mbox, rawEmail) {
		const escaped = ('\n' + (rawEmail || '')).replace(/\nFrom /g, '\n>From ').slice(1);
		return mbox + '\nFrom - cloud-mail\n' + escaped + '\n';
	},

	splitNextBatch(mbox, cursor, maxCount) {
		const messages = [];
		const len = mbox.length;
		let pos = cursor;
		if (mbox.indexOf('\nFrom ', pos) !== pos) {
			const p = mbox.indexOf('\nFrom ', pos);
			if (p === -1) {
				return { messages, nextCursor: cursor, done: true };
			}
			pos = p;
		}
		while (messages.length < maxCount) {
			const fromF = pos + 1;
			const nextSep = mbox.indexOf('\nFrom ', fromF);
			const end = nextSep === -1 ? len : nextSep;
			const seg = mbox.slice(fromF, end);
			const nl = seg.indexOf('\n');
			let body = nl >= 0 ? seg.slice(nl + 1) : '';
			body = body.replace(/\n$/, '').replace(/^>From /gm, 'From ');
			messages.push(body);
			pos = nextSep;
			if (nextSep === -1) {
				return { messages, nextCursor: len, done: true };
			}
		}
		return { messages, nextCursor: pos, done: false };
	},

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

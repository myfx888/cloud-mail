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
	},

	findMessagesInBytes(bytes, startOffset, maxCount, isEof) {
		const SEP = [0x0a, 0x46, 0x72, 0x6f, 0x6d, 0x20];
		const positions = [];
		for (let i = 0; i <= bytes.length - SEP.length; i++) {
			let m = true;
			for (let j = 0; j < SEP.length; j++) {
				if (bytes[i + j] !== SEP[j]) { m = false; break; }
			}
			if (m) positions.push(i);
		}
		const messages = [];
		if (positions.length === 0) {
			return { messages, nextCursor: startOffset + bytes.length, done: isEof };
		}
		for (let i = 0; i < positions.length - 1 && messages.length < maxCount; i++) {
			messages.push(bytes.slice(positions[i] + 1, positions[i + 1]));
		}
		const lastPos = positions[positions.length - 1];
		if (isEof) {
			if (messages.length < maxCount) {
				const last = bytes.slice(lastPos + 1);
				if (last.length > 0) messages.push(last);
			}
			return { messages, nextCursor: startOffset + bytes.length, done: true };
		}
		return { messages, nextCursor: startOffset + lastPos, done: false };
	}
};

export default mboxUtils;

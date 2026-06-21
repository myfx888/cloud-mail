const tarUtils = {

	pack(entries) {
		const enc = new TextEncoder();
		const chunks = [];
		for (const e of entries) {
			const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
			const nameBuf = enc.encode(e.name);
			const header = new Uint8Array(512);
			header.set(nameBuf.slice(0, 100));
			this._setOctal(header, 100, 0o644, 7);
			this._setOctal(header, 108, 0, 7);
			this._setOctal(header, 116, 0, 7);
			this._setOctal(header, 124, data.length, 11);
			this._setOctal(header, 136, Math.floor(Date.now() / 1000), 11);
			header[156] = 0x30;
			header.set(enc.encode('ustar'), 257);
			header[263] = 0x30;
			header[264] = 0x30;
			this._setChecksum(header);
			chunks.push(header);
			chunks.push(this._pad512(data));
		}
		chunks.push(new Uint8Array(1024));
		let total = 0;
		chunks.forEach(c => total += c.length);
		const out = new Uint8Array(total);
		let off = 0;
		for (const c of chunks) {
			out.set(c, off);
			off += c.length;
		}
		return out;
	},

	unpack(tar) {
		const dec = new TextDecoder();
		const result = {};
		let off = 0;
		while (off + 512 <= tar.length) {
			const header = tar.slice(off, off + 512);
			if (header.every(b => b === 0)) break;
			const name = dec.decode(header.slice(0, 100)).replace(/\0+$/, '');
			const size = parseInt(dec.decode(header.slice(124, 136)).replace(/\0/g, ''), 8) || 0;
			off += 512;
			if (name) {
				result[name] = dec.decode(tar.slice(off, off + size));
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
		for (let i = 148; i < 156; i++) header[i] = 0x20;
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

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

	it('总长度为 512 倍数且结尾两空块', () => {
		const tar = tarUtils.pack([{ name: 'a.txt', data: 'hi' }]);
		expect(tar.length % 512).toBe(0);
		const tail = tar.slice(-1024);
		expect(tail.every(b => b === 0)).toBe(true);
	});
});

import PostalMime from 'postal-mime';

export async function parseEmailRaw(emlText) {
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
}

export default { parseEmailRaw };

import { encode, encodeQuotedPrintable } from './utils.js';

export function encodeHeader(text) {
  if (!/[^\x00-\x7F]/.test(text)) {
    return text;
  }
  const bytes = encode(text);
  let encoded = '';

  for (const byte of bytes) {
    if (
      byte >= 33 &&
      byte <= 126 &&
      byte !== 63 &&
      byte !== 61 &&
      byte !== 95
    ) {
      encoded += String.fromCharCode(byte);
    } else if (byte === 32) {
      encoded += '_';
    } else {
      encoded += `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }

  return `=?UTF-8?Q?${encoded}?=`;
}

export class Email {
  constructor(options) {
    if (!options.text && !options.html) {
      throw new Error('At least one of text or html must be provided');
    }

    if (typeof options.from === 'string') {
      this.from = { email: options.from };
    } else {
      this.from = options.from;
    }
    if (typeof options.reply === 'string') {
      this.reply = { email: options.reply };
    } else {
      this.reply = options.reply;
    }
    this.to = Email.toUsers(options.to);
    this.cc = Email.toUsers(options.cc);
    this.bcc = Email.toUsers(options.bcc);

    this.subject = options.subject;
    this.text = options.text;
    this.html = options.html;
    this.attachments = options.attachments;
    this.dsnOverride = options.dsnOverride;
    this.headers = options.headers || {};

    this.sent = new Promise((resolve, reject) => {
      this.setSent = resolve;
      this.setSentError = reject;
    });
  }

  static toUsers(user) {
    if (!user) {
      return;
    }
    if (typeof user === 'string') {
      return [{ email: user }];
    } else if (Array.isArray(user)) {
      return user.map(u => {
        if (typeof u === 'string') {
          return { email: u };
        }
        return u;
      });
    } else {
      return [user];
    }
  }

  getEmailData() {
    this.resolveHeader();

    const headersArray = ['MIME-Version: 1.0'];
    for (const [key, value] of Object.entries(this.headers)) {
      headersArray.push(`${key}: ${value}`);
    }
    const mixedBoundary = this.generateSafeBoundary('mixed_');
    const alternativeBoundary = this.generateSafeBoundary('alternative_');

    headersArray.push(
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    );
    const headers = headersArray.join('\r\n');

    let emailData = `${headers}\r\n\r\n`;
    emailData += `--${mixedBoundary}\r\n`;

    emailData += `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"\r\n\r\n`;

    if (this.text) {
      emailData += `--${alternativeBoundary}\r\n`;
      emailData += `Content-Type: text/plain; charset="UTF-8"\r\n`;
      emailData += `Content-Transfer-Encoding: quoted-printable\r\n\r\n`;
      const encodedText = encodeQuotedPrintable(this.text);
      emailData += `${encodedText}\r\n\r\n`;
    }

    if (this.html) {
      emailData += `--${alternativeBoundary}\r\n`;
      emailData += `Content-Type: text/html; charset="UTF-8"\r\n`;
      emailData += `Content-Transfer-Encoding: quoted-printable\r\n\r\n`;
      const encodedHtml = encodeQuotedPrintable(this.html);
      emailData += `${encodedHtml}\r\n\r\n`;
    }

    emailData += `--${alternativeBoundary}--\r\n`;

    if (this.attachments) {
      for (const attachment of this.attachments) {
        const mimeType =
          attachment.mimeType || this.getMimeType(attachment.filename);
        emailData += `--${mixedBoundary}\r\n`;
        emailData += `Content-Type: ${mimeType}; name="${attachment.filename}"\r\n`;
        emailData += `Content-Description: ${attachment.filename}\r\n`;
        emailData += `Content-Disposition: attachment; filename="${attachment.filename}";\r\n`;
        emailData += `    creation-date="${new Date().toUTCString()}";\r\n`;
        emailData += `Content-Transfer-Encoding: base64\r\n\r\n`;

        const lines = attachment.content.match(/.{1,72}/g);
        if (lines) {
          emailData += `${lines.join('\r\n')}`;
        } else {
          emailData += `${attachment.content}`;
        }
        emailData += '\r\n\r\n';
      }
    }
    emailData += `--${mixedBoundary}--\r\n`;

    const safeEmailData = this.applyDotStuffing(emailData);

    return `${safeEmailData}\r\n.\r\n`;
  }

  applyDotStuffing(data) {
    let result = data.replace(/\r\n\./g, '\r\n..');
    if (result.startsWith('.')) {
      result = `.${result}`;
    }
    return result;
  }

  generateSafeBoundary(prefix) {
    const bytes = new Uint8Array(28);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    let boundary = prefix + hex;
    boundary = boundary.replace(/[<>@,;:\\/[\]?=" ]/g, '_');

    return boundary;
  }

  getMimeType(filename) {
    const extension = filename.split('.').pop()?.toLowerCase();

    const mimeTypes = {
      txt: 'text/plain',
      html: 'text/html',
      csv: 'text/csv',
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      zip: 'application/zip',
    };

    return mimeTypes[extension || 'txt'] || 'application/octet-stream';
  }

  resolveHeader() {
    this.resolveFrom();
    this.resolveTo();
    this.resolveReply();
    this.resolveCC();
    this.resolveBCC();
    this.resolveSubject();
    this.headers['Date'] = this.headers['Date'] ?? new Date().toUTCString();
    this.headers['Message-ID'] =
      this.headers['Message-ID'] ??
      `<${crypto.randomUUID()}@${this.from.email.split('@').pop()}>`;
  }

  resolveFrom() {
    if (this.headers['From']) {
      return;
    }
    let from = this.from.email;
    if (this.from.name) {
      from = `"${encodeHeader(this.from.name)}" <${from}>`;
    }
    this.headers['From'] = from;
  }

  resolveTo() {
    if (this.headers['To']) {
      return;
    }
    const toAddresses = this.to.map(user => {
      if (user.name) {
        return `"${encodeHeader(user.name)}" <${user.email}>`;
      }
      return user.email;
    });
    this.headers['To'] = toAddresses.join(', ');
  }

  resolveSubject() {
    if (this.headers['Subject']) {
      return;
    }
    if (this.subject) {
      this.headers['Subject'] = encodeHeader(this.subject);
    }
  }

  resolveReply() {
    if (this.headers['Reply-To']) {
      return;
    }
    if (this.reply) {
      let replyAddress = this.reply.email;
      if (this.reply.name) {
        replyAddress = `"${encodeHeader(this.reply.name)}" <${replyAddress}>`;
      }
      this.headers['Reply-To'] = replyAddress;
    }
  }

  resolveCC() {
    if (this.headers['CC']) {
      return;
    }
    if (this.cc) {
      const ccAddresses = this.cc.map(user => {
        if (user.name) {
          return `"${encodeHeader(user.name)}" <${user.email}>`;
        }
        return user.email;
      });
      this.headers['CC'] = ccAddresses.join(', ');
    }
  }

  resolveBCC() {
    if (this.headers['BCC']) {
      return;
    }
    if (this.bcc) {
      const bccAddresses = this.bcc.map(user => {
        if (user.name) {
          return `"${encodeHeader(user.name)}" <${user.email}>`;
        }
        return user.email;
      });
      this.headers['BCC'] = bccAddresses.join(', ');
    }
  }
}

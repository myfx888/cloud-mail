import { connect } from 'cloudflare:sockets';
import { BlockingQueue, decode, encode, execTimeout } from './utils.js';
import { Email } from './email.js';
import Logger, { LogLevel } from './logger.js';

export class WorkerMailer {
  constructor(options) {
    this.port = options.port;
    this.host = options.host;
    this.secure = !!options.secure;
    if (Array.isArray(options.authType)) {
      this.authType = options.authType;
    } else if (typeof options.authType === 'string') {
      this.authType = [options.authType];
    } else {
      this.authType = [];
    }
    this.startTls = options.startTls === undefined ? true : options.startTls;
    this.credentials = options.credentials;
    this.dsn = options.dsn || {};

    this.socketTimeoutMs = options.socketTimeoutMs || 60000;
    this.responseTimeoutMs = options.responseTimeoutMs || 30000;

    this.logger = new Logger(
      options.logLevel,
      `[WorkerMailer:${this.host}:${this.port}]`,
    );

    this.active = false;
    this.emailSending = null;
    this.emailToBeSent = new BlockingQueue();

    this.supportsDSN = false;
    this.allowAuth = false;
    this.authTypeSupported = [];
    this.supportsStartTls = false;

    this.logger.info(`Initializing connection to ${this.host}:${this.port} (secure: ${this.secure}, startTls: ${this.startTls})`);
    
    try {
      this.socket = connect(
        {
          hostname: this.host,
          port: this.port,
        },
        {
          secureTransport: this.secure
            ? 'on'
            : this.startTls
              ? 'starttls'
              : 'off',
          allowHalfOpen: false,
        },
      );
      
      this.socket.opened.then(() => {
        this.logger.info('Socket opened successfully');
      }).catch(err => {
        this.logger.error(`Socket failed to open: ${err.message}`, {
          code: err.code,
          name: err.name,
          stack: err.stack
        });
      });

      this.reader = this.socket.readable.getReader();
      this.writer = this.socket.writable.getWriter();
    } catch (e) {
      this.logger.error(`Catch block - Failed to create/connect socket: ${e.message}`, {
        code: e.code,
        name: e.name
      });
      throw e;
    }
  }

  static async connect(options) {
    const mailer = new WorkerMailer(options);
    await mailer.initializeSmtpSession();
    mailer.start().catch(err => mailer.logger.error('Background loop error:', err));
    return mailer;
  }

  async send(options) {
    const email = new Email(options);
    this.emailToBeSent.enqueue(email);
    return email.sent;
  }

  static async send(options, emailOptions) {
    const mailer = await WorkerMailer.connect(options);
    await mailer.send(emailOptions);
    await mailer.close();
  }

  async readTimeout() {
    return execTimeout(
      this.read(),
      this.responseTimeoutMs,
      new Error('Timeout while waiting for smtp server response'),
    );
  }

  async read() {
    let response = '';
    while (true) {
      const { value } = await this.reader.read();
      if (!value) {
        continue;
      }
      const data = decode(value).toString();
      this.logger.debug('SMTP server response:\n' + data);
      response = response + data;
      if (!response.endsWith('\n')) {
        continue;
      }
      const lines = response.split(/\r?\n/);
      const lastLine = lines[lines.length - 2];
      if (/^\d+-/.test(lastLine)) {
        continue;
      }
      return response;
    }
  }

  async writeLine(line) {
    await this.write(`${line}\r\n`);
  }

  async write(data) {
    this.logger.debug('Write to socket:\n' + data);
    await this.writer.write(encode(data));
  }

  async initializeSmtpSession() {
    await this.waitForSocketConnected();
    await this.greet();
    await this.ehlo();

    if (this.startTls && !this.secure && this.supportsStartTls) {
      await this.tls();
      await this.ehlo();
    }

    await this.auth();
    this.active = true;
  }

  async start() {
    while (this.active) {
      this.emailSending = await this.emailToBeSent.dequeue();
      try {
        await this.mail();
        await this.rcpt();
        await this.data();
        await this.body();
        this.emailSending.setSent();
      } catch (e) {
        this.logger.error('Failed to send email: ' + e.message);
        if (!this.active) {
          return;
        }
        this.emailSending.setSentError(e);
        try {
          await this.rset();
        } catch (resetErr) {
          await this.close(resetErr);
        }
      }
      this.emailSending = null;
    }
  }

  async close(error) {
    this.active = false;
    this.logger.info('WorkerMailer is closed', error?.message || '');
    if (this.emailSending && typeof this.emailSending.setSentError === 'function') {
      this.emailSending.setSentError(error || new Error('WorkerMailer is shutting down'));
    }
    
    while (this.emailToBeSent.length) {
      const email = await this.emailToBeSent.dequeue();
      email.setSentError(error || new Error('WorkerMailer is shutting down'));
    }

    try {
      await this.writeLine('QUIT');
      await this.readTimeout();
      this.socket.close().catch(() => this.logger.error('Failed to close socket'));
    } catch (ignore) {}
  }

  async waitForSocketConnected() {
    this.logger.info(`Connecting to SMTP server`);
    await execTimeout(
      this.socket.opened,
      this.socketTimeoutMs,
      new Error('Socket timeout!'),
    );
    this.logger.info('SMTP server connected');
  }

  async greet() {
    const response = await this.readTimeout();
    if (!response.startsWith('220')) {
      throw new Error('Failed to connect to SMTP server: ' + response);
    }
  }

  async ehlo() {
    await this.writeLine(`EHLO 127.0.0.1`);
    const response = await this.readTimeout();
    if (response.startsWith('421')) {
      throw new Error(`Failed to EHLO. ${response}`);
    }
    if (!response.startsWith('2')) {
      await this.helo();
      return;
    }
    this.parseCapabilities(response);
  }

  async helo() {
    await this.writeLine(`HELO 127.0.0.1`);
    const response = await this.readTimeout();
    if (response.startsWith('2')) {
      return;
    }
    throw new Error(`Failed to HELO. ${response}`);
  }

  async tls() {
    this.logger.info('Upgrading connection to STARTTLS');
    await this.writeLine('STARTTLS');
    const response = await this.readTimeout();
    if (!response.startsWith('220')) {
      this.logger.error(`STARTTLS command failed: ${response}`);
      throw new Error('Failed to start TLS: ' + response);
    }

    try {
      this.logger.info('Starting TLS handshake...');
      this.reader.releaseLock();
      this.writer.releaseLock();
      this.socket = this.socket.startTls({ expected: this.host });
      
      // Monitor the new socket's status
      this.socket.opened.then(() => {
        this.logger.info('TLS handshake successful, socket re-opened');
      }).catch(err => {
        this.logger.error(`TLS handshake failed: ${err.message}`, {
          code: err.code,
          stack: err.stack
        });
      });

      this.reader = this.socket.readable.getReader();
      this.writer = this.socket.writable.getWriter();
    } catch (e) {
      this.logger.error(`Error during startTls() call: ${e.message}`);
      throw e;
    }
  }

  parseCapabilities(response) {
    if (/[ -]AUTH\b/i.test(response)) {
      this.allowAuth = true;
    }
    if (/[ -]AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)PLAIN/i.test(response)) {
      this.authTypeSupported.push('plain');
    }
    if (/[ -]AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)LOGIN/i.test(response)) {
      this.authTypeSupported.push('login');
    }
    if (/[ -]AUTH(?:(\s+|=)[^\n]*\s+|\s+|=)CRAM-MD5/i.test(response)) {
      this.authTypeSupported.push('cram-md5');
    }
    if (/[ -]STARTTLS\b/i.test(response)) {
      this.supportsStartTls = true;
    }
    if (/[ -]DSN\b/i.test(response)) {
      this.supportsDSN = true;
    }
  }

  async auth() {
    if (!this.allowAuth) {
      return;
    }
    if (!this.credentials) {
      throw new Error('smtp server requires authentication, but no credentials found');
    }
    if (this.authTypeSupported.includes('plain') && this.authType.includes('plain')) {
      await this.authWithPlain();
    } else if (this.authTypeSupported.includes('login') && this.authType.includes('login')) {
      await this.authWithLogin();
    } else if (this.authTypeSupported.includes('cram-md5') && this.authType.includes('cram-md5')) {
      await this.authWithCramMD5();
    } else {
      throw new Error('No supported auth method found.');
    }
  }

  async authWithPlain() {
    const userPassBase64 = btoa(`\u0000${this.credentials.username}\u0000${this.credentials.password}`);
    await this.writeLine(`AUTH PLAIN ${userPassBase64}`);
    const authResult = await this.readTimeout();
    if (!authResult.startsWith('2')) {
      throw new Error(`Failed to plain authentication: ${authResult}`);
    }
  }

  async authWithLogin() {
    await this.writeLine(`AUTH LOGIN`);
    const startLoginResponse = await this.readTimeout();
    if (!startLoginResponse.startsWith('3')) {
      throw new Error('Invalid login: ' + startLoginResponse);
    }

    const usernameBase64 = btoa(this.credentials.username);
    await this.writeLine(usernameBase64);
    const userResponse = await this.readTimeout();
    if (!userResponse.startsWith('3')) {
      throw new Error('Failed to login authentication: ' + userResponse);
    }

    const passwordBase64 = btoa(this.credentials.password);
    await this.writeLine(passwordBase64);
    const authResult = await this.readTimeout();
    if (!authResult.startsWith('2')) {
      throw new Error('Failed to login authentication: ' + authResult);
    }
  }

  async authWithCramMD5() {
    await this.writeLine('AUTH CRAM-MD5');
    const challengeResponse = await this.readTimeout();
    const challengeWithBase64Encoded = challengeResponse.match(/^334\s+(.+)$/)?.pop();
    if (!challengeWithBase64Encoded) {
      throw new Error('Invalid CRAM-MD5 challenge: ' + challengeResponse);
    }

    const challenge = atob(challengeWithBase64Encoded);
    const keyData = encode(this.credentials.password);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'MD5' },
      false,
      ['sign'],
    );

    const challengeData = encode(challenge);
    const signature = await crypto.subtle.sign('HMAC', key, challengeData);
    const challengeSolved = Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    await this.writeLine(btoa(`${this.credentials.username} ${challengeSolved}`));
    const authResult = await this.readTimeout();
    if (!authResult.startsWith('2')) {
      throw new Error('Failed to cram-md5 authentication: ' + authResult);
    }
  }

  async mail() {
    let message = `MAIL FROM: <${this.emailSending.from.email}>`;
    if (this.supportsDSN) {
      message += ` ${this.retBuilder()}`;
      if (this.emailSending.dsnOverride?.envelopeId) {
        message += ` ENVID=${this.emailSending.dsnOverride.envelopeId}`;
      }
    }

    await this.writeLine(message);
    const response = await this.readTimeout();
    if (!response.startsWith('2')) {
      throw new Error(`Invalid ${message} ${response}`);
    }
  }

  async rcpt() {
    const allRecipients = [
      ...this.emailSending.to,
      ...(this.emailSending.cc || []),
      ...(this.emailSending.bcc || []),
    ];

    for (let user of allRecipients) {
      let message = `RCPT TO: <${user.email}>`;
      if (this.supportsDSN) {
        message += this.notificationBuilder();
      }
      await this.writeLine(message);
      const rcptResponse = await this.readTimeout();
      if (!rcptResponse.startsWith('2')) {
        throw new Error(`Invalid ${message} ${rcptResponse}`);
      }
    }
  }

  async data() {
    await this.writeLine('DATA');
    const response = await this.readTimeout();
    if (!response.startsWith('3')) {
      throw new Error(`Failed to send DATA: ${response}`);
    }
  }

  async body() {
    await this.write(this.emailSending.getEmailData());
    const response = await this.readTimeout();
    if (!response.startsWith('2')) {
      throw new Error('Failed send email body: ' + response);
    }
  }

  async rset() {
    await this.writeLine('RSET');
    const response = await this.readTimeout();
    if (!response.startsWith('2')) {
      throw new Error(`Failed to reset: ${response}`);
    }
  }

  notificationBuilder() {
    const notifications = [];
    if (
      (this.emailSending.dsnOverride?.NOTIFY &&
        this.emailSending.dsnOverride?.NOTIFY?.SUCCESS) ||
      (!this.emailSending.dsnOverride?.NOTIFY && this.dsn?.NOTIFY?.SUCCESS)
    ) {
      notifications.push('SUCCESS');
    }
    if (
      (this.emailSending.dsnOverride?.NOTIFY &&
        this.emailSending.dsnOverride?.NOTIFY?.FAILURE) ||
      (!this.emailSending.dsnOverride?.NOTIFY && this.dsn?.NOTIFY?.FAILURE)
    ) {
      notifications.push('FAILURE');
    }
    if (
      (this.emailSending.dsnOverride?.NOTIFY &&
        this.emailSending.dsnOverride?.NOTIFY?.DELAY) ||
      (!this.emailSending.dsnOverride?.NOTIFY && this.dsn?.NOTIFY?.DELAY)
    ) {
      notifications.push('DELAY');
    }
    return notifications.length > 0
      ? ` NOTIFY=${notifications.join(',')}`
      : ' NOTIFY=NEVER';
  }

  retBuilder() {
    const ret = [];
    if (
      (this.emailSending.dsnOverride?.RET &&
        this.emailSending.dsnOverride?.RET?.HEADERS) ||
      (!this.emailSending.dsnOverride?.RET && this.dsn?.RET?.HEADERS)
    ) {
      ret.push('HDRS');
    }
    if (
      (this.emailSending.dsnOverride?.RET &&
        this.emailSending.dsnOverride?.RET?.FULL) ||
      (!this.emailSending.dsnOverride?.RET && this.dsn?.RET?.FULL)
    ) {
      ret.push('FULL');
    }
    return ret.length > 0 ? `RET=${ret.join(',')}` : '';
  }
}

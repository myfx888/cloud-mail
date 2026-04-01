export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  NONE: 4,
};

export default class Logger {
  constructor(level = LogLevel.INFO, prefix) {
    this.level = level;
    this.prefix = prefix;
  }

  debug(message, ...args) {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(this.prefix + message, ...args);
    }
  }

  info(message, ...args) {
    if (this.level <= LogLevel.INFO) {
      console.info(this.prefix + message, ...args);
    }
  }

  warn(message, ...args) {
    if (this.level <= LogLevel.WARN) {
      console.warn(this.prefix + message, ...args);
    }
  }

  error(message, ...args) {
    if (this.level <= LogLevel.ERROR) {
      console.error(this.prefix + message, ...args);
    }
  }
}

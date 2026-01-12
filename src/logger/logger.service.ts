import { Injectable, LoggerService as NestLoggerService } from '@nestjs/common';
import { Logger } from 'winston';
import { createAppLogger } from '../config/logger.config';

@Injectable()
export class AppLoggerService implements NestLoggerService {
  private readonly logger: Logger;

  constructor() {
    this.logger = createAppLogger();
  }

  log(message: string, context?: string) {
    this.logger.info(message, { context });
  }

  error(message: string, trace?: string, context?: string) {
    this.logger.error(message, { trace, context });
  }

  warn(message: string, context?: string) {
    this.logger.warn(message, { context });
  }

  debug(message: string, context?: string) {
    this.logger.debug(message, { context });
  }

  verbose(message: string, context?: string) {
    this.logger.verbose(message, { context });
  }

  child(meta: Record<string, unknown>): Logger {
    return this.logger.child(meta);
  }
}

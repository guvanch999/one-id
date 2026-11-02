import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { ErrorCode } from '../constants/error-codes';
import { AppLoggerService } from '../../logger/logger.service';
import type { RequestWithContext } from '../types/request-context';

interface NormalizedError {
  status: number;
  message: string;
  code: ErrorCode;
  details: unknown;
}

interface HttpExceptionBody {
  message?: string | string[];
  error?: string;
  details?: unknown;
}

const ERROR_CODES = new Set<string>(Object.values(ErrorCode));

/**
 * Renders every error as `{ error, message, details, timestamp, path, requestId }`.
 *
 * When an exception carries one of our domain error codes in its `error`
 * field (e.g. `token_revoked`), that code is returned as-is; otherwise the
 * code is derived from the HTTP status.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithContext>();

    const { status, message, code, details } = this.normalizeError(exception);

    if (status >= 500) {
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
        HttpExceptionFilter.name,
      );
    } else {
      this.logger.warn(
        `${status} ${code}: ${message}`,
        HttpExceptionFilter.name,
      );
    }

    response.status(status).json({
      error: code,
      message,
      details,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId: request.requestId,
    });
  }

  private normalizeError(exception: unknown): NormalizedError {
    if (!(exception instanceof HttpException)) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
        code: ErrorCode.UNKNOWN_ERROR,
        details: {},
      };
    }

    const status = exception.getStatus();
    const body = exception.getResponse() as string | HttpExceptionBody;

    if (typeof body === 'string') {
      return {
        status,
        message: body,
        code: this.mapStatusToCode(status),
        details: {},
      };
    }

    const messages = Array.isArray(body.message) ? body.message : undefined;
    const message = messages
      ? messages.join(', ')
      : typeof body.message === 'string' && body.message
        ? body.message
        : exception.message;
    const code =
      body.error && ERROR_CODES.has(body.error)
        ? (body.error as ErrorCode)
        : this.mapStatusToCode(status);
    const details = body.details ?? (messages ? { errors: messages } : {});

    return { status, message, code, details };
  }

  private mapStatusToCode(status: HttpStatus): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.VALIDATION_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.CONFLICT:
        return ErrorCode.CONFLICT;
      default:
        return ErrorCode.UNKNOWN_ERROR;
    }
  }
}

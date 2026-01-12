import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorCode } from '../constants/error-codes';
import { AppLoggerService } from '../../logger/logger.service';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, message, code, details } =
      this.normalizeError(exception as Error);

    this.logger.error(message, (exception as Error)?.stack, 'HttpException');

    response.status(status).json({
      error: code,
      message,
      details,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId: (request as any).requestId,
    });
  }

  private normalizeError(exception: Error) {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse() as
        | string
        | { message?: string | string[]; error?: string };
      const message =
        typeof response === 'string'
          ? response
          : Array.isArray(response?.message)
            ? response.message.join(', ')
            : response?.message || exception.message;

      const details = typeof response === 'string' ? {} : response;

      return {
        status,
        message,
        code: this.mapStatusToCode(status),
        details,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      code: ErrorCode.UNKNOWN_ERROR,
      details: {},
    };
  }

  private mapStatusToCode(status: number): ErrorCode {
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

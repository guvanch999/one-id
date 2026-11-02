import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AppLoggerService } from '../../logger/logger.service';
import type { RequestWithContext } from '../types/request-context';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: AppLoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const start = Date.now();

    const header = request.headers['x-request-id'];
    const requestId =
      (Array.isArray(header) ? header[0] : header) || randomUUID();
    request.requestId = requestId;

    const meta = {
      requestId,
      method: request.method,
      url: request.url,
      userId: request.user?.id ?? null,
    };

    this.logger.log('Request start', 'RequestLoggingInterceptor');

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - start;
        this.logger.log('Request completed', 'RequestLoggingInterceptor');
        this.logger.debug(
          `Request meta: ${JSON.stringify({ ...meta, duration })}`,
          'RequestLoggingInterceptor',
        );
      }),
    );
  }
}

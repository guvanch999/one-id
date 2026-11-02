import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { randomUUID } from 'node:crypto';
import { AppLoggerService } from '../../logger/logger.service';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: AppLoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const start = Date.now();

    const requestId = request.headers['x-request-id'] || randomUUID();
    request.requestId = requestId;

    const meta = {
      requestId,
      method: request.method,
      url: request.url,
      userId: request.user?.id ?? request.user?.sub ?? null,
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

import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ErrorCode } from '../constants/error-codes';
import { AppLoggerService } from '../../logger/logger.service';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  const logger = { warn: jest.fn(), error: jest.fn() };
  const appLogger = logger as unknown as AppLoggerService;
  const filter = new HttpExceptionFilter(appLogger);

  let body: Record<string, unknown> | undefined;
  const json = jest.fn((payload: Record<string, unknown>) => {
    body = payload;
  });
  const status = jest.fn(() => ({ json }));

  const handle = (exception: unknown) => {
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/api/auth/refresh', requestId: 'req-1' }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(exception, host);
    return body;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    body = undefined;
  });

  it('keeps domain error codes thrown by services', () => {
    const exception = new UnauthorizedException({
      error: ErrorCode.TOKEN_REVOKED,
      message: 'Refresh token revoked or expired',
      details: {},
    });

    const result = handle(exception);

    expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(result).toMatchObject({
      error: ErrorCode.TOKEN_REVOKED,
      message: 'Refresh token revoked or expired',
      details: {},
      path: '/api/auth/refresh',
      requestId: 'req-1',
    });
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('maps class-validator errors to validation_error', () => {
    const errors = ['email must be an email', 'password too short'];

    const result = handle(new BadRequestException(errors));

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(result).toMatchObject({
      error: ErrorCode.VALIDATION_ERROR,
      message: 'email must be an email, password too short',
      details: { errors },
    });
  });

  it('derives the code from the status for plain HTTP exceptions', () => {
    const result = handle(new HttpException('Nope', HttpStatus.NOT_FOUND));

    expect(result).toMatchObject({
      error: ErrorCode.NOT_FOUND,
      message: 'Nope',
      details: {},
    });
  });

  it('hides unexpected errors behind a generic 500', () => {
    const result = handle(new Error('connection refused'));

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(result).toMatchObject({
      error: ErrorCode.UNKNOWN_ERROR,
      message: 'Internal server error',
    });
    expect(logger.error).toHaveBeenCalled();
  });
});

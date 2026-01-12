import { format, transports, createLogger, LoggerOptions } from 'winston';

export const buildLoggerOptions = (): LoggerOptions => {
  const logLevel = process.env.LOG_LEVEL || 'info';

  return {
    level: logLevel,
    transports: [
      new transports.Console({
        handleExceptions: true,
      }),
    ],
    format: format.combine(
      format.timestamp(),
      format.errors({ stack: true }),
      format.splat(),
      format.json(),
    ),
  };
};

export const createAppLogger = () => createLogger(buildLoggerOptions());

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { setupSwagger } from './swagger/swagger.config';
import { AppLoggerService } from './logger/logger.service';

async function bootstrap() {
  const appLogger = new AppLoggerService();
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(appLogger);
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter(appLogger));
  app.useGlobalInterceptors(new RequestLoggingInterceptor(appLogger));

  setupSwagger(app);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  appLogger.log(`Server listening on port ${port}`);
}

void bootstrap();

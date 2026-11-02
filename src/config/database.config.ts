import { registerAs } from '@nestjs/config';

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  logging: boolean;
  ssl: boolean;
  sslRejectUnauthorized: boolean;
}

export default registerAs(
  'database',
  (): DatabaseConfig => ({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'oneid',
    password: process.env.DB_PASSWORD || 'oneid',
    database: process.env.DB_NAME || 'oneid',
    logging: (process.env.DB_LOGGING || '').toLowerCase() === 'true',
    ssl: (process.env.DB_SSL || '').toLowerCase() === 'true',
    // Verify the server certificate unless explicitly disabled.
    sslRejectUnauthorized:
      (process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() !== 'false',
  }),
);

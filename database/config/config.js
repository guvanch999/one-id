require('dotenv').config();

const base = {
  dialect: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  username: process.env.DB_USER || 'oneid',
  password: process.env.DB_PASSWORD || 'oneid',
  database: process.env.DB_NAME || 'oneid',
  logging: false,
  dialectOptions:
    (process.env.DB_SSL || '').toLowerCase() === 'true'
      ? {
          ssl: {
            require: true,
            rejectUnauthorized:
              (process.env.DB_SSL_REJECT_UNAUTHORIZED || '').toLowerCase() !==
              'false',
          },
        }
      : {},
};

module.exports = {
  development: base,
  test: base,
  production: base,
};

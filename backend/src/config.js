import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || required('JWT_SECRET') + '-refresh',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  uploadDir: process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  /** Email code for login/register. Unset or any value except "false" keeps OTP on. */
  emailOtp: String(process.env.AUTH_EMAIL_OTP ?? 'true').toLowerCase() !== 'false',
  /** −50% for the first 3 monthly payments of the first 30 organizations. Off only when EARLY_PROMO=false. */
  earlyPromo: String(process.env.EARLY_PROMO ?? 'true').toLowerCase() !== 'false',
  supportEmail: String(process.env.SUPPORT_EMAIL || 'support@nova-crm.online').trim() || 'support@nova-crm.online',
};

if (process.env.NODE_ENV === 'production') {
  if (process.env.COOKIE_SECURE !== 'true') {
    throw new Error('В продакшене COOKIE_SECURE должен быть true');
  }
  if (String(process.env.JWT_SECRET || '').length < 32) {
    throw new Error('В продакшене JWT_SECRET должен быть не короче 32 символов');
  }
}

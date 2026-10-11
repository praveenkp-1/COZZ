import { config } from "dotenv";
import { z } from "zod";
config({ path: [".env", "../.env"], quiet: true });
const schema = z.object({
  PORTFOLIO_DEMO: z.enum(["true", "false"]).default("false"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.url().default("http://localhost:5173"),
  PUBLIC_API_ORIGIN: z.url().default("http://localhost:5173"),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  PAYHERE_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
  PAYHERE_MERCHANT_ID: z.string().default(""),
  PAYHERE_MERCHANT_SECRET: z.string().default(""),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: z.string().default("false"),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  MAIL_FROM: z.string().default(""),
  CLOUDINARY_CLOUD_NAME: z.string().default(""),
  CLOUDINARY_API_KEY: z.string().default(""),
  CLOUDINARY_API_SECRET: z.string().default(""),
});
export const env = schema.parse(process.env);
export const paymentConfigured = !!(
  env.PAYHERE_MERCHANT_ID && env.PAYHERE_MERCHANT_SECRET
);
if (env.NODE_ENV === "production") {
  for (const value of [env.APP_ORIGIN, env.PUBLIC_API_ORIGIN])
    if (!value.startsWith("https://") || /localhost|127\.0\.0\.1/.test(value))
      throw new Error("Production requires public HTTPS origins.");
    if (
  env.PORTFOLIO_DEMO !== "true" &&
  (!env.SMTP_HOST || !env.MAIL_FROM)
  ) {
  throw new Error("Production requires configured transactional email.");
}
}

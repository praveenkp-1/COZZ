import express from "express";
import cors from "cors";
import * as helmetModule from "helmet";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { db } from "./config/db.js";
import { logger } from "./utils/logger.js";
import { AppError } from "./utils/errors.js";
import { sessionMiddleware, csrf } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { catalogRouter } from "./routes/catalog.js";
import { customerRouter } from "./routes/customer.js";
import { adminRouter } from "./routes/admin.js";
import { processNotification } from "./services/orders.js";
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);
  app.use(
    pinoHttp({
      logger,
      autoLogging: env.NODE_ENV !== "test",
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: String(req.url).split("?")[0],
        }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(
  helmetModule.default({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          formAction: [
            "'self'",
            "https://sandbox.payhere.lk",
            "https://www.payhere.lk",
          ],
          upgradeInsecureRequests: env.NODE_ENV === "production" ? [] : null,
        },
      },
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      strictTransportSecurity:
        env.NODE_ENV === "production" ? undefined : false,
    }),
  );
  app.use(cors({ origin: new URL(env.APP_ORIGIN).origin, credentials: true }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: env.NODE_ENV === "test" ? 5000 : 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "Too many requests. Please try again shortly." },
    }),
  );
  app.get("/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: "ready" });
  });
  app.post(
    "/api/v1/payments/payhere/notify",
    express.urlencoded({ extended: false, limit: "16kb" }),
    async (req, res) => {
      await processNotification(req.body);
      res.status(200).send("OK");
    },
  );
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use("/api/v1", catalogRouter);
  app.use("/api/v1", sessionMiddleware, csrf);
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1", customerRouter);
  app.use("/api/v1/admin", adminRouter);
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "API endpoint not found." }),
  );
  return app;
}
export const errorHandler: express.ErrorRequestHandler = (
  error,
  req,
  res,
  _next,
) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: error.issues[0]?.message ?? "Please check your input.",
      issues: error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  if (error?.code === "P2002") {
    res
      .status(409)
      .json({ error: "A record with these details already exists." });
    return;
  }
  if (error?.code === "P2025") {
    res.status(404).json({ error: "Record not found." });
    return;
  }
  if (error?.code === "LIMIT_FILE_SIZE") {
    res.status(400).json({ error: "Images must be smaller than 8 MB." });
    return;
  }
  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ error: "Invalid JSON." });
    return;
  }
  logger.error(
    {
      err: { name: error?.name, message: error?.message, code: error?.code },
      requestId: req.id,
    },
    "Request failed",
  );
  res.status(500).json({
    error: "Something went wrong. Please try again.",
    requestId: req.id,
  });
};

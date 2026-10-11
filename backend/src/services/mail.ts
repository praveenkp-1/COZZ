import nodemailer from "nodemailer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../config/db.js";
import { env } from "../config/env.js";
import type { Prisma } from "../generated/prisma/client.js";
import { logger } from "../utils/logger.js";
export async function queueEmail(
  tx: Prisma.TransactionClient,
  to: string,
  subject: string,
  text: string,
) {
  await tx.emailJob.create({ data: { to, subject, text } });
}
let running = false;
export async function deliverMail() {
  if (running) return;
  running = true;
  try {
    const jobs = await db.emailJob.findMany({
      where: {
        sentAt: null,
        nextAttemptAt: { lte: new Date() },
        attempts: { lt: 8 },
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
      },
      take: 20,
      orderBy: { createdAt: "asc" },
    });
    const transport = env.SMTP_HOST
      ? nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE === "true",
          requireTLS: env.NODE_ENV === "production",
          disableFileAccess: true,
          disableUrlAccess: true,
          auth: env.SMTP_USER
            ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
            : undefined,
          connectionTimeout: 10000,
          socketTimeout: 15000,
        })
      : null;
    for (const job of jobs) {
      try {
        const claim = await db.emailJob.updateMany({
          where: {
            id: job.id,
            sentAt: null,
            OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }],
          },
          data: { lockedUntil: new Date(Date.now() + 120000) },
        });
        if (!claim.count) continue;
        if (transport)
          await transport.sendMail({
            from: env.MAIL_FROM,
            to: job.to,
            subject: job.subject,
            text: job.text,
            messageId: `<${job.id}@${new URL(env.APP_ORIGIN).hostname}>`,
          });
        else if (env.NODE_ENV !== "production") {
          const dir = path.resolve(
            process.cwd().endsWith("backend") ? ".." : ".",
            ".local/mail",
          );
          await mkdir(dir, { recursive: true });
          await writeFile(
            path.join(dir, `${job.id}.txt`),
            `To: ${job.to}\nSubject: ${job.subject}\n\n${job.text}`,
            { mode: 0o600 },
          );
        } else throw new Error("Email transport is not configured");
        await db.emailJob.update({
          where: { id: job.id },
          data: {
            sentAt: new Date(),
            lockedUntil: null,
            text: "[Delivered; content removed]",
          },
        });
      } catch {
        await db.emailJob.update({
          where: { id: job.id },
          data: {
            lockedUntil: null,
            attempts: { increment: 1 },
            nextAttemptAt: new Date(
              Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts),
            ),
          },
        });
        logger.error(
          { jobId: job.id },
          "Email delivery failed; retry scheduled",
        );
      }
    }
    transport?.close();
  } finally {
    running = false;
  }
}

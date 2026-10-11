import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { db } from "../config/db.js";
import { env } from "../config/env.js";
import {
  registerSchema,
  loginSchema,
  emailSchema,
  passwordSchema,
} from "../../../shared/contracts.js";
import { authenticated, issueSession, userView } from "../middleware/auth.js";
import { randomToken, hashToken } from "../utils/crypto.js";
import { assert } from "../utils/errors.js";
import { serializable } from "../utils/transaction.js";
import { queueEmail } from "../services/mail.js";
import type { Prisma } from "../generated/prisma/client.js";
export const authRouter = Router();
const limiter = rateLimit({
  windowMs: 15 * 60000,
  limit: env.NODE_ENV === "test" ? 500 : 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again in 15 minutes." },
});
async function accountToken(
  tx: Prisma.TransactionClient,
  userId: string,
  email: string,
  kind: "VERIFY" | "RESET",
) {
  const token = randomToken();
  await tx.accountToken.deleteMany({ where: { userId, kind } });
  await tx.accountToken.create({
    data: {
      userId,
      kind,
      tokenHash: hashToken(token),
      expiresAt: new Date(
        Date.now() + (kind === "VERIFY" ? 24 * 3600000 : 3600000),
      ),
    },
  });
  await queueEmail(
    tx,
    email,
    kind === "VERIFY" ? "Verify your COZZY email" : "Reset your COZZY password",
    `${kind === "VERIFY" ? "Verify your email" : "Reset your password"} using this one-time link:\n${env.APP_ORIGIN}/account/${kind === "VERIFY" ? "verify" : "reset"}#token=${token}\nIf you did not request this, ignore this message.`,
  );
}
authRouter.get("/session", (req, res) =>
  res.json({
    user: userView(req.session.user),
    csrfToken: req.session.csrfToken,
  }),
);
authRouter.post("/register", limiter, async (req, res) => {
  const input = registerSchema.parse(req.body);
  const passwordHash = await bcrypt.hash(input.password, 12);
  await serializable(async (tx) => {
    assert(
      !(await tx.user.findUnique({ where: { email: input.email } })),
      409,
      "An account already uses this email.",
    );
    const user = await tx.user.create({
      data: { name: input.name, email: input.email, passwordHash },
    });
    await accountToken(tx, user.id, user.email, "VERIFY");
  });
  res.status(201).json({
    message: "Account created. Check your email to verify it, then sign in.",
  });
});
const dummyHash = bcrypt.hashSync("dummy-password-for-timing-only", 12);
authRouter.post("/login", limiter, async (req, res) => {
  const input = loginSchema.parse(req.body);
  const user = await db.user.findUnique({ where: { email: input.email } });
  const valid = await bcrypt.compare(
    input.password,
    user?.passwordHash ?? dummyHash,
  );
  assert(user && valid && user.active, 401, "Email or password is incorrect.");
  const cartId = await serializable(async (tx) => {
    const cart = await tx.cart.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });
    if (cart.id !== req.session.cartId) {
      const items = await tx.cartItem.findMany({
        where: { cartId: req.session.cartId },
      });
      for (const item of items) {
        const existing = await tx.cartItem.findUnique({
          where: {
            cartId_variantId: { cartId: cart.id, variantId: item.variantId },
          },
        });
        await tx.cartItem.upsert({
          where: {
            cartId_variantId: { cartId: cart.id, variantId: item.variantId },
          },
          create: {
            cartId: cart.id,
            variantId: item.variantId,
            quantity: item.quantity,
          },
          update: {
            quantity: Math.min(10, (existing?.quantity ?? 0) + item.quantity),
          },
        });
      }
      await tx.cartItem.deleteMany({ where: { cartId: req.session.cartId } });
    }
    await tx.session.deleteMany({ where: { id: req.session.id } });
    return cart.id;
  });
  const session = await issueSession(res, cartId, user.id);
  res.json({ user: userView(user), csrfToken: session.csrfToken });
});
authRouter.post("/logout", async (req, res) => {
  await db.session.deleteMany({ where: { id: req.session.id } });
  const cart = await db.cart.create({ data: {} });
  const session = await issueSession(res, cart.id);
  res.json({ user: null, csrfToken: session.csrfToken });
});
authRouter.post("/forgot", limiter, async (req, res) => {
  const { email } = z.object({ email: emailSchema }).strict().parse(req.body);
  const user = await db.user.findUnique({ where: { email } });
  if (user?.active)
    await db.$transaction((tx) => accountToken(tx, user.id, email, "RESET"));
  res.json({
    message: "If an account matches, recovery instructions will be emailed.",
  });
});
authRouter.post(
  "/resend-verification",
  limiter,
  authenticated,
  async (req, res) => {
    const user = req.session.user!;
    if (!user.verifiedAt)
      await db.$transaction((tx) =>
        accountToken(tx, user.id, user.email, "VERIFY"),
      );
    res.json({ message: "Verification instructions have been requested." });
  },
);
authRouter.post("/verify", limiter, async (req, res) => {
  const { token } = z
    .object({ token: z.string().length(64) })
    .strict()
    .parse(req.body);
  await serializable(async (tx) => {
    const record = await tx.accountToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    assert(
      record && record.kind === "VERIFY" && record.expiresAt > new Date(),
      400,
      "This verification link is invalid or expired.",
    );
    await tx.user.update({
      where: { id: record.userId },
      data: { verifiedAt: new Date() },
    });
    await tx.accountToken.delete({ where: { id: record.id } });
  });
  res.json({ message: "Email verified. You can now place orders." });
});
authRouter.post("/reset", limiter, async (req, res) => {
  const input = z
    .object({ token: z.string().length(64), password: passwordSchema })
    .strict()
    .parse(req.body);
  const passwordHash = await bcrypt.hash(input.password, 12);
  await serializable(async (tx) => {
    const token = await tx.accountToken.findUnique({
      where: { tokenHash: hashToken(input.token) },
    });
    assert(
      token && token.kind === "RESET" && token.expiresAt > new Date(),
      400,
      "This reset link is invalid or expired.",
    );
    await tx.user.update({
      where: { id: token.userId },
      data: { passwordHash },
    });
    await tx.accountToken.deleteMany({
      where: { userId: token.userId, kind: "RESET" },
    });
    await tx.session.deleteMany({ where: { userId: token.userId } });
  });
  res.json({ message: "Password updated. Sign in with your new password." });
});
authRouter.patch("/profile", authenticated, async (req, res) => {
  const { name } = z
    .object({ name: z.string().trim().min(2).max(100) })
    .strict()
    .parse(req.body);
  const user = await db.user.update({
    where: { id: req.session.user!.id },
    data: { name },
  });
  res.json(userView(user));
});
authRouter.post("/password", limiter, authenticated, async (req, res) => {
  const input = z
    .object({ currentPassword: z.string().max(200), password: passwordSchema })
    .strict()
    .parse(req.body);
  assert(
    await bcrypt.compare(input.currentPassword, req.session.user!.passwordHash),
    400,
    "Current password is incorrect.",
  );
  const passwordHash = await bcrypt.hash(input.password, 12);
  await db.$transaction([
    db.user.update({
      where: { id: req.session.user!.id },
      data: { passwordHash },
    }),
    db.session.deleteMany({
      where: { userId: req.session.user!.id, id: { not: req.session.id } },
    }),
  ]);
  res.json({
    message: "Password updated. Other sessions have been signed out.",
  });
});

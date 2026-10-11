import type { Request, Response, NextFunction } from "express";
import type { Session, User } from "../generated/prisma/client.js";
import { db } from "../config/db.js";
import { env } from "../config/env.js";
import { randomToken, hashToken, safeEqual } from "../utils/crypto.js";
import { assert } from "../utils/errors.js";
declare global {
  namespace Express {
    interface Request {
      session: Session & { user: User | null };
    }
  }
}
const cookieName = env.NODE_ENV === "production" ? "__Host-cozzy" : "cozzy";
export const userView = (u: User | null) =>
  u
    ? {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        verified: !!u.verifiedAt,
      }
    : null;
export async function issueSession(
  res: Response,
  cartId: string,
  userId?: string,
) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 7 * 86400000);
  const session = await db.session.create({
    data: {
      tokenHash: hashToken(token),
      csrfToken: randomToken(),
      cartId,
      userId,
      expiresAt,
    },
    include: { user: true },
  });
  res.cookie(cookieName, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return session;
}
export async function sessionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = req.cookies[cookieName];
  let session =
    typeof token === "string" && token.length === 64
      ? await db.session.findUnique({
          where: { tokenHash: hashToken(token) },
          include: { user: true },
        })
      : null;
  if (
    session &&
    (session.expiresAt < new Date() || (session.user && !session.user.active))
  ) {
    await db.session.deleteMany({ where: { id: session.id } });
    session = null;
  }
  if (!session) {
    assert(
      req.method === "GET" && req.path === "/auth/session",
      401,
      "Your session expired. Refresh the page and try again.",
    );
    const cart = await db.cart.create({ data: {} });
    session = await issueSession(res, cart.id);
  }
  req.session = session;
  res.setHeader("Cache-Control", "no-store");
  next();
}
export function csrf(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  assert(
    req.get("origin") === new URL(env.APP_ORIGIN).origin,
    403,
    "This request origin is not allowed.",
  );
  const token = req.get("x-csrf-token");
  assert(
    token && safeEqual(token, req.session.csrfToken),
    403,
    "The security token expired. Refresh and try again.",
  );
  next();
}
export function authenticated(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  assert(req.session.user, 401, "Please sign in to continue.");
  next();
}
export function administrator(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  assert(
    req.session.user?.role === "ADMIN",
    403,
    "Administrator access is required.",
  );
  next();
}
export function verified(req: Request, _res: Response, next: NextFunction) {
  assert(
    req.session.user?.verifiedAt,
    403,
    "Verify your email before placing an order.",
    "EMAIL_NOT_VERIFIED",
  );
  next();
}

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
export const randomToken = () => randomBytes(32).toString("hex");
export const hashToken = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

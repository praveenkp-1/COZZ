import { db } from "../config/db.js";
import type { Prisma } from "../generated/prisma/client.js";
// Adapter errors may surface at COMMIT without Prisma's P2034 wrapper.
function retryable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; kind?: string; cause?: unknown };
  return (
    ["P2034", "P2002", "40001", "40P01"].includes(e.code ?? "") ||
    e.kind === "TransactionWriteConflict" ||
    (e.cause !== error && retryable(e.cause))
  );
}
export async function serializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: "Serializable",
        timeout: 15000,
      });
    } catch (error) {
      if (attempt < 4 && retryable(error)) {
        await new Promise((resolve) =>
          setTimeout(resolve, 20 * 2 ** attempt + Math.random() * 25),
        );
        continue;
      }
      throw error;
    }
  }
}

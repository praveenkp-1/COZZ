import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readCheckoutKey,
  saveCheckoutKey,
  clearCheckoutKey,
} from "../../frontend/src/services/checkout";
import {
  paymentMethodLabel,
  paymentStatusLabel,
} from "../../frontend/src/services/orders";
import type { Order } from "../../frontend/src/types";
afterEach(() => vi.unstubAllGlobals());
describe("checkout recovery and cash payment displays", () => {
  it("retains the checkout key across component lifetimes and scopes it to its owner", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    const key = "12c7a75d-a217-40bb-b14e-8c0d4ebfb632";
    saveCheckoutKey("customer-a", key);
    expect(readCheckoutKey("customer-a")).toBe(key);
    expect(readCheckoutKey("customer-b")).toBe("");
    clearCheckoutKey("customer-a");
    expect(readCheckoutKey("customer-a")).toBe("");
  });
  it("ignores corrupted storage and tolerates browsers with storage disabled", () => {
    vi.stubGlobal("window", {
      sessionStorage: { getItem: () => "not-a-uuid" },
    });
    expect(readCheckoutKey("customer")).toBe("");
    vi.stubGlobal("window", {
      get sessionStorage() {
        throw new Error("Storage disabled");
      },
    });
    expect(readCheckoutKey("customer")).toBe("");
    expect(() => saveCheckoutKey("customer", "key")).not.toThrow();
    expect(() => clearCheckoutKey("customer")).not.toThrow();
  });
  it("distinguishes an uncollected COD order from a collected cash receipt and PayHere payment", () => {
    const cash: NonNullable<Order["payment"]> = {
      provider: "COD",
      status: "PENDING_COLLECTION",
      providerPaymentId: null,
      refundReference: null,
      collectedAt: null,
      collectedById: null,
    };
    expect(paymentMethodLabel(cash)).toBe("Cash on Delivery");
    expect(paymentStatusLabel(cash)).toBe("Awaiting collection");
    expect(paymentStatusLabel({ ...cash, status: "PAID" })).toBe("Collected");
    expect(paymentStatusLabel({ ...cash, status: "FAILED" })).toContain(
      "not collected",
    );
    expect(
      paymentStatusLabel({ ...cash, provider: "PAYHERE", status: "PAID" }),
    ).toBe("paid");
  });
});

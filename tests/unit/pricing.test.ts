import { describe, it, expect } from "vitest";
import { calculateTotals } from "../../backend/src/services/pricing";
const shipping = { fee: 50000, freeAbove: 1500000 };
const coupon = {
  active: true,
  percent: 10,
  minimum: 100000,
  maximumDiscount: 200000,
  maxUses: 10,
  uses: 0,
  expiresAt: new Date("2099-01-01"),
};
describe("server pricing", () => {
  it("uses integer minor units and rounds tax once", () => {
    expect(
      calculateTotals(
        [{ unitPrice: 579900, quantity: 2 }],
        shipping,
        1800,
        coupon,
      ),
    ).toEqual({
      subtotal: 1159800,
      discount: 115980,
      shipping: 50000,
      tax: 187888,
      total: 1281708,
      currency: "LKR",
    });
  });
  it("applies free delivery after discounts", () => {
    expect(
      calculateTotals(
        [{ unitPrice: 1500000, quantity: 1 }],
        shipping,
        0,
        coupon,
      ).shipping,
    ).toBe(50000);
    expect(
      calculateTotals([{ unitPrice: 1600000, quantity: 1 }], shipping, 0)
        .shipping,
    ).toBe(0);
  });
  it("caps percentage discounts", () => {
    expect(
      calculateTotals(
        [{ unitPrice: 10000000, quantity: 1 }],
        shipping,
        0,
        coupon,
      ).discount,
    ).toBe(200000);
  });
  it.each([
    { ...coupon, active: false },
    { ...coupon, uses: 10 },
    { ...coupon, expiresAt: new Date(0) },
  ])("rejects unavailable coupons", (rule) => {
    expect(() =>
      calculateTotals([{ unitPrice: 1000000, quantity: 1 }], shipping, 0, rule),
    ).toThrow("unavailable");
  });
  it("rejects empty carts, invalid quantities, and unmet coupon minimums", () => {
    expect(() => calculateTotals([], shipping, 0)).toThrow("empty");
    expect(() =>
      calculateTotals([{ unitPrice: 100, quantity: 0 }], shipping, 0),
    ).toThrow("Invalid");
    expect(() =>
      calculateTotals([{ unitPrice: 100, quantity: 1 }], shipping, 0, coupon),
    ).toThrow("minimum");
  });
});

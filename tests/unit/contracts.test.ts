import { describe, it, expect } from "vitest";
import {
  passwordSchema,
  checkoutSchema,
  productSchema,
  cartItemSchema,
  addressSchema,
} from "../../shared/contracts";
describe("commerce contracts", () => {
  it("accepts COD and PayHere while rejecting frontend totals and other methods", () => {
    const input = {
      address: {
        name: "Test Customer",
        phone: "0771234567",
        line1: "12 Test Road",
        line2: "",
        city: "Colombo",
        postalCode: "00100",
        country: "LK",
      },
      shippingMethodId: "standard",
      paymentMethod: "COD",
    };
    expect(checkoutSchema.safeParse(input).success).toBe(true);
    expect(
      checkoutSchema.safeParse({ ...input, paymentMethod: "PAYHERE" }).success,
    ).toBe(true);
    expect(
      checkoutSchema.safeParse({ ...input, paymentMethod: "CASH" }).success,
    ).toBe(false);
    expect(checkoutSchema.safeParse({ ...input, total: 1 }).success).toBe(
      false,
    );
  });
  it("rejects mass assignment of cart prices", () => {
    expect(
      cartItemSchema.safeParse({ variantId: "abc", quantity: 1, price: 1 })
        .success,
    ).toBe(false);
  });
  it("requires strong passwords within bcrypt UTF-8 length limits", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("🔒".repeat(20)).success).toBe(false);
    expect(passwordSchema.safeParse("a unique long password").success).toBe(
      true,
    );
  });
  it("validates Sri Lankan phone and postal codes", () => {
    const address = {
      name: "Test Customer",
      phone: "0771234567",
      line1: "12 Test Road",
      line2: "",
      city: "Colombo",
      postalCode: "00100",
      country: "LK",
    };
    expect(addressSchema.safeParse(address).success).toBe(true);
    expect(
      addressSchema.safeParse({ ...address, phone: "123", postalCode: "ABC" })
        .success,
    ).toBe(false);
  });
  it("rejects unsafe image sources and duplicate size/color variants", () => {
    const base = {
      name: "Test Product",
      slug: "test-product",
      description: "A real product description.",
      categoryId: "cat",
      gender: "men",
      price: 10000,
      images: [{ url: "/media/test.webp", alt: "Test" }],
      variants: [{ sku: "sku1", size: "M", color: "Black", stock: 1 }],
    };
    expect(productSchema.safeParse(base).success).toBe(true);
    expect(
      productSchema.safeParse({
        ...base,
        images: [{ url: "javascript:alert(1)", alt: "Test" }],
      }).success,
    ).toBe(false);
    expect(
      productSchema.safeParse({
        ...base,
        variants: [...base.variants, { ...base.variants[0], sku: "sku2" }],
      }).success,
    ).toBe(false);
  });
});

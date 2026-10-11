import { z } from "zod";
export const emailSchema = z
  .email()
  .max(254)
  .transform((v) => v.toLowerCase().trim());
export const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(72, "Use at most 72 characters.")
  .refine(
    (v) => BufferByteLength(v) <= 72,
    "Password must be at most 72 UTF-8 bytes.",
  );
function BufferByteLength(v: string) {
  return new TextEncoder().encode(v).length;
}
export const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: emailSchema,
    password: passwordSchema,
    consent: z.literal(true, { error: "Please accept the privacy policy." }),
  })
  .strict();
export const loginSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(200) })
  .strict();
export const addressSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    phone: z
      .string()
      .trim()
      .regex(
        /^(?:\+94|0)[0-9]{9}$/,
        "Enter a Sri Lankan phone number, e.g. 0771234567.",
      ),
    line1: z.string().trim().min(3).max(200),
    line2: z.string().trim().max(200),
    city: z.string().trim().min(2).max(100),
    postalCode: z.string().regex(/^\d{5}$/, "Enter a five-digit postal code."),
    country: z.literal("LK"),
  })
  .strict();
export const checkoutSchema = z
  .object({
    address: addressSchema,
    billingAddress: addressSchema.optional(),
    shippingMethodId: z.string().min(1).max(80),
    couponCode: z.string().trim().max(40).default(""),
    paymentMethod: z.enum(["COD", "PAYHERE"]),
    notes: z.string().trim().max(500).default(""),
  })
  .strict();
export const quoteSchema = checkoutSchema.pick({
  shippingMethodId: true,
  couponCode: true,
});
export const cartItemSchema = z
  .object({
    variantId: z.string().min(1).max(80),
    quantity: z.number().int().min(1).max(10),
  })
  .strict();
export const productQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  category: z.string().max(100).default(""),
  gender: z.enum(["men", "women", ""]).default(""),
  min: z.coerce.number().min(0).max(100000000).default(0),
  max: z.coerce.number().min(0).max(100000000).default(100000000),
  size: z.string().max(20).default(""),
  color: z.string().max(40).default(""),
  sort: z
    .enum(["newest", "price-asc", "price-desc", "popular"])
    .default("newest"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
  featured: z.enum(["true", "false"]).optional(),
  collection: z.string().max(100).default(""),
});
export const variantSchema = z
  .object({
    id: z.string().optional(),
    sku: z.string().trim().min(1).max(80),
    size: z.string().trim().min(1).max(20),
    color: z.string().trim().min(1).max(40),
    stock: z.number().int().min(0).max(100000),
    price: z.number().int().min(1).max(100000000).nullable().default(null),
  })
  .strict();
export const imageSchema = z
  .object({
    url: z
      .string()
      .max(1000)
      .refine(
        (v) =>
          /^\/media\/[a-zA-Z0-9._-]+\.webp$/.test(v) ||
          /^https:\/\/res\.cloudinary\.com\//.test(v),
        "Use an imported image or a Cloudinary upload.",
      ),
    alt: z.string().min(1).max(200),
  })
  .strict();
export const productSchema = z
  .object({
    name: z.string().trim().min(2).max(180),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(200),
    description: z.string().trim().min(10).max(10000),
    categoryId: z.string().min(1),
    gender: z.enum(["men", "women"]),
    price: z.number().int().min(1).max(100000000),
    compareAtPrice: z
      .number()
      .int()
      .min(1)
      .max(100000000)
      .nullable()
      .default(null),
    active: z.boolean().default(true),
    featured: z.boolean().default(false),
    images: z.array(imageSchema).min(1).max(15),
    variants: z.array(variantSchema).min(1).max(100),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.variants.map((x) => `${x.size}:${x.color}`)).size ===
      v.variants.length,
    "Variant size and color combinations must be unique.",
  )
  .refine(
    (v) => !v.compareAtPrice || v.compareAtPrice > v.price,
    "Original price must exceed the selling price.",
  );
export const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_-]{3,40}$/),
    percent: z.number().int().min(1).max(100),
    minimum: z.number().int().min(0).max(100000000),
    maximumDiscount: z.number().int().min(0).max(100000000),
    maxUses: z.number().int().min(1).max(1000000),
    expiresAt: z.iso.datetime(),
    active: z.boolean(),
  })
  .strict();
export const settingsSchema = z
  .object({
    storeName: z.string().min(2).max(60),
    supportEmail: z.union([z.email(), z.literal("")]),
    announcement: z.string().max(200),
    taxBasisPoints: z.number().int().min(0).max(3000),
    privacy: z.string().max(20000),
    shippingPolicy: z.string().max(20000),
    returnsPolicy: z.string().max(20000),
    terms: z.string().max(20000),
    policiesPublished: z.boolean(),
  })
  .strict();
export const shippingSchema = z
  .object({
    name: z.string().min(2).max(100),
    description: z.string().max(200),
    fee: z.number().int().min(0).max(10000000),
    freeAbove: z.number().int().min(0).max(100000000),
    active: z.boolean(),
  })
  .strict();
export const reviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    title: z.string().trim().min(2).max(100),
    body: z.string().trim().min(10).max(2000),
  })
  .strict();
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type AddressInput = z.infer<typeof addressSchema>;

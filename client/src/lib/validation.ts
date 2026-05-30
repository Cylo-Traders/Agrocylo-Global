import { z } from "zod/v4";

export const stellarAddressSchema = z.string().regex(/^G[A-Z0-9]{55}$/, {
  message: "Invalid Stellar wallet address",
});

export const emailSchema = z.string().email("Invalid email address");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Display name is required")
  .max(100, "Display name must be 100 characters or less");

export const bioSchema = z.string().max(280, "Bio must be 280 characters or less").optional();

export const productNameSchema = z
  .string()
  .trim()
  .min(1, "Product name is required")
  .max(200, "Product name must be 200 characters or less");

export const priceSchema = z
  .string()
  .regex(/^\d+(\.\d{1,7})?$/, "Invalid price format")
  .refine((v) => parseFloat(v) > 0, "Price must be greater than 0");

export const quantitySchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "Invalid quantity")
  .refine((v) => parseFloat(v) > 0, "Quantity must be greater than 0");

export const stockQuantitySchema = z
  .string()
  .regex(/^\d*$/, "Stock must be a whole number")
  .optional()
  .default("");

export const locationSchema = z.string().trim().min(1, "Location is required").max(200);

export const deliveryWindowSchema = z.string().trim().min(1, "Delivery window is required").max(100);

export const descriptionSchema = z.string().max(2000, "Description must be 2000 characters or less").optional();

export const notesSchema = z.string().max(500, "Notes must be 500 characters or less").optional();

export const categorySchema = z.enum([
  "Vegetables",
  "Fruits",
  "Grains",
  "Tubers",
  "Livestock",
  "Other",
]);

export const currencySchema = z.enum(["STRK", "USDC"]);

export const unitSchema = z.enum(["kg", "bag", "crate", "piece", "litre", "dozen", "bunch"]);

export const deliveryDeadlineSchema = z.string().min(1, "Delivery deadline is required");

export const amountSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/, "Invalid amount")
  .refine((v) => parseFloat(v) > 0, "Amount must be greater than 0");

export const fileSizeSchema = (maxMb: number) =>
  z
    .any()
    .refine(
      (file: File | null) => !file || file.size <= maxMb * 1024 * 1024,
      `File size must be ${maxMb}MB or less`,
    );

export const fileTypeSchema = (types: string[]) =>
  z
    .any()
    .refine(
      (file: File | null) => !file || types.includes(file.type),
      `File type must be one of: ${types.join(", ")}`,
    );

export const productFormSchema = z.object({
  name: productNameSchema,
  category: categorySchema,
  pricePerUnit: priceSchema,
  currency: currencySchema,
  unit: unitSchema,
  stockQuantity: stockQuantitySchema,
  description: descriptionSchema,
  isAvailable: z.boolean(),
  location: locationSchema,
  deliveryWindow: deliveryWindowSchema,
});

export const barterItemSchema = z.object({
  product_name: z.string().trim().min(1, "Product name is required"),
  category: categorySchema,
  quantity: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Invalid quantity")
    .refine((v) => parseFloat(v) > 0, "Quantity must be positive"),
  unit: unitSchema,
});

export const barterFormSchema = z
  .object({
    recipientWallet: stellarAddressSchema,
    offerItems: z.array(barterItemSchema).min(1, "Add at least one item you are offering"),
    requestItems: z.array(barterItemSchema).min(1, "Add at least one item you want to receive"),
    expiryHours: z.number().positive(),
    includeCollateral: z.boolean(),
    collateralAmount: z.string().optional(),
    collateralCurrency: currencySchema.optional(),
    notes: notesSchema,
  })
  .refine(
    (data) =>
      !data.includeCollateral ||
      (data.collateralAmount && parseFloat(data.collateralAmount) > 0),
    { message: "Collateral amount must be positive", path: ["collateral"] },
  );

export const createOrderFormSchema = z.object({
  farmer: stellarAddressSchema,
  amount: amountSchema,
  deliveryDeadline: deliveryDeadlineSchema,
  description: descriptionSchema,
});

export const disputeFormSchema = z.object({
  reason: z.string().trim().min(1, "Reason is required").max(2000, "Reason must be 2000 characters or less"),
});

export const profileFormSchema = z.object({
  displayName: displayNameSchema,
  bio: bioSchema,
});

export const escrowFormSchema = z.object({
  quantity: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "Quantity must be a valid number")
    .refine((v) => parseFloat(v) > 0, "Quantity must be greater than 0"),
  deliveryDeadline: z
    .string()
    .min(1, "Delivery deadline is required")
    .refine((v) => {
      if (!v) return false;
      const selected = new Date(v);
      const now = new Date();
      return selected > now;
    }, "Delivery deadline must be in the future"),
});


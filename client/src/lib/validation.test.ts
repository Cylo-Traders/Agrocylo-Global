import { describe, it, expect } from "vitest";
import { escrowFormSchema } from "./validation";

describe("escrowFormSchema validation", () => {
  it("should validate successfully with correct values", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);
    const result = escrowFormSchema.safeParse({
      quantity: "15",
      deliveryDeadline: futureDate.toISOString(),
    });
    expect(result.success).toBe(true);
  });

  it("should fail with non-positive quantities", () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);
    const resultNeg = escrowFormSchema.safeParse({
      quantity: "-5",
      deliveryDeadline: futureDate.toISOString(),
    });
    expect(resultNeg.success).toBe(false);

    const resultZero = escrowFormSchema.safeParse({
      quantity: "0",
      deliveryDeadline: futureDate.toISOString(),
    });
    expect(resultZero.success).toBe(false);

    const resultEmpty = escrowFormSchema.safeParse({
      quantity: "",
      deliveryDeadline: futureDate.toISOString(),
    });
    expect(resultEmpty.success).toBe(false);
  });

  it("should fail with past delivery deadlines", () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    const result = escrowFormSchema.safeParse({
      quantity: "10",
      deliveryDeadline: pastDate.toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it("should fail with empty or invalid delivery deadlines", () => {
    const resultEmpty = escrowFormSchema.safeParse({
      quantity: "10",
      deliveryDeadline: "",
    });
    expect(resultEmpty.success).toBe(false);

    const resultInvalid = escrowFormSchema.safeParse({
      quantity: "10",
      deliveryDeadline: "not-a-date",
    });
    expect(resultInvalid.success).toBe(false);
  });
});

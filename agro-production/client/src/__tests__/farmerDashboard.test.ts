import { describe, expect, it } from "vitest";
import {
  filterOrdersForFarmer,
  summarizeFarmerOrders,
} from "@/lib/farmerDashboard";
import {
  BULK_IMPORT_CSV_TEMPLATE,
  buildBulkImportPreview,
  summarizeBulkImport,
} from "@/lib/bulkProductImport";
import type { Order } from "@/types";

const FARMER = "GFARMER";

const orders: Order[] = [
  {
    id: "order-pending",
    onChainId: "1",
    campaignId: "campaign-a",
    buyerAddress: "GBUYER",
    amount: "15000000",
    status: "PENDING",
    ledger: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    campaign: { farmerAddress: FARMER, tokenAddress: "GTOKEN", onChainId: "1" },
  },
  {
    id: "order-confirmed",
    onChainId: "2",
    campaignId: "campaign-a",
    buyerAddress: "GBUYER2",
    amount: "25000000",
    status: "CONFIRMED",
    ledger: 2,
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    campaign: { farmerAddress: FARMER, tokenAddress: "GTOKEN", onChainId: "1" },
  },
  {
    id: "other-farmer",
    onChainId: "3",
    campaignId: "campaign-b",
    buyerAddress: "GBUYER3",
    amount: "99999999",
    status: "CONFIRMED",
    ledger: 3,
    createdAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    campaign: { farmerAddress: "GOTHER", tokenAddress: "GTOKEN", onChainId: "2" },
  },
];

describe("farmer dashboard order summary", () => {
  it("shows only orders on campaigns owned by the connected farmer", () => {
    expect(filterOrdersForFarmer(orders, FARMER).map((order) => order.id)).toEqual([
      "order-pending",
      "order-confirmed",
    ]);
  });

  it("separates outstanding fulfilment from confirmed revenue using integer totals", () => {
    const summary = summarizeFarmerOrders(filterOrdersForFarmer(orders, FARMER));
    expect(summary.pendingDeliveries).toHaveLength(1);
    expect(summary.completedOrders).toHaveLength(1);
    expect(summary.pendingValue).toBe(15_000_000n);
    expect(summary.completedRevenue).toBe(25_000_000n);
  });
});

describe("bulk product import", () => {
  it("documents required and optional fields with example rows in the template", () => {
    expect(BULK_IMPORT_CSV_TEMPLATE).toContain("name");
    expect(BULK_IMPORT_CSV_TEMPLATE).toContain("price");
    expect(BULK_IMPORT_CSV_TEMPLATE).toContain("quantity");
    expect(BULK_IMPORT_CSV_TEMPLATE).toContain("description");
    expect(BULK_IMPORT_CSV_TEMPLATE.split("\n").length).toBeGreaterThan(2);
  });

  it("flags invalid rows and duplicates before submission", () => {
    const csv = [
      "name,price,quantity,description",
      "Tomatoes,100,5,Fresh",
      "Tomatoes,100,5,Fresh",
      ",abc,-1,Bad row",
    ].join("\n");
    const preview = buildBulkImportPreview(csv, []);
    expect(preview.rows[0].status).toBe("valid");
    expect(preview.rows[1].status).toBe("duplicate");
    expect(preview.rows[2].status).toBe("invalid");
    expect(preview.rows[2].errors.length).toBeGreaterThan(0);
  });

  it("reports created, skipped, and failed rows in the final summary", () => {
    const summary = summarizeBulkImport([
      { rowNumber: 2, status: "created" },
      { rowNumber: 3, status: "skipped" },
      { rowNumber: 4, status: "failed" },
    ]);
    expect(summary).toEqual({ created: 1, skipped: 1, failed: 1 });
  });
});

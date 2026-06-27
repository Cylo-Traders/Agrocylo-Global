"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
  ShoppingBag,
  X,
} from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useCart } from "@/context/CartContext";
import type { CartGroup } from "@/types/cart";
import { useWallet } from "@/hooks/useWallet";
import {
  createOrderWithOrderId,
  approveToken,
} from "@/services/stellar/contractService";
import { getNetworkConfig, requireTokenContractId } from "@/services/stellar/networkConfig";
import { formatTruncatedAddress } from "@/lib/helpers/format-address";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────

type OrderSuccess = { orderId: string; farmerWallet: string; txHash: string };
type OrderFailure = { farmerWallet: string; error: string };
type GroupStatus = "pending" | "success" | "error";

const PLATFORM_FEE_BPS = BigInt(300); // 3% in basis points
const BPS_DENOM = BigInt(10_000);

function feeFromGross(gross: bigint) {
  return (gross * PLATFORM_FEE_BPS) / BPS_DENOM;
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CartDrawer() {
  const router = useRouter();
  const {
    cart,
    cartLoading,
    cartError,
    drawerOpen,
    setDrawerOpen,
    itemCount,
    refreshCart,
    setQuantityForProduct,
    removeCartItem,
  } = useCart();
  const { address, connected, signAndSubmit } = useWallet();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [deliveryDeadline, setDeliveryDeadline] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [successOrders, setSuccessOrders] = useState<OrderSuccess[]>([]);
  const [failedOrders, setFailedOrders] = useState<OrderFailure[]>([]);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [groupProgress, setGroupProgress] = useState<
    Record<string, GroupStatus>
  >({});

  const totals = useMemo(() => {
    const gross = cart.groups.reduce(
      (acc, g) => acc + (BigInt(g.subtotal) || BigInt(0)),
      BigInt(0),
    );
    const fee = feeFromGross(gross);
    const net = gross - fee;
    return { gross, fee, net };
  }, [cart.groups]);

  const closeAndReset = () => {
    setStep(1);
    setRunning(false);
    setDeliveryDeadline("");
    setSuccessOrders([]);
    setFailedOrders([]);
    setProgressMessage("");
    setGroupProgress({});
    setDrawerOpen(false);
  };

  async function createOrdersForCart(groups: CartGroup[]) {
    if (!address || !connected) {
      toast.error("Connect your wallet to checkout.");
      return;
    }
    const deadline = deliveryDeadline?.trim();
    if (!deadline) {
      toast.error("Please select a delivery deadline.");
      return;
    }

    setRunning(true);
    setSuccessOrders([]);
    setFailedOrders([]);
    setProgressMessage("Starting checkout…");
    setGroupProgress(
      Object.fromEntries(groups.map((g) => [g.farmer_wallet, "pending"])),
    );

    try {
      // Sequential — Freighter only handles one signing prompt at a time.
      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const farmerWallet = group.farmer_wallet;
        const idxLabel = `${i + 1} of ${groups.length}`;

        const gross = BigInt(group.subtotal || "0");
        const net = gross - feeFromGross(gross);

        setProgressMessage(`Creating order ${idxLabel}…`);

        let tokenContractId: string;
        try {
          tokenContractId = requireTokenContractId(group.currency);
        } catch {
          const error = `Missing token contract for ${group.currency}.`;
          setFailedOrders((prev) => [...prev, { farmerWallet, error }]);
          setGroupProgress((prev) => ({ ...prev, [farmerWallet]: "error" }));
          continue;
        }

        if (net <= BigInt(0)) {
          const error = "Net amount must be positive.";
          setFailedOrders((prev) => [...prev, { farmerWallet, error }]);
          setGroupProgress((prev) => ({ ...prev, [farmerWallet]: "error" }));
          continue;
        }

        const { contractId } = getNetworkConfig();

        // Step A: token approval (best-effort — skip on simulation failure).
        if (contractId && contractId.trim().length > 0) {
          const approval = await approveToken(
            address,
            tokenContractId,
            contractId,
            net,
          );
          if (approval.success && approval.data) {
            setProgressMessage(`Approving escrow (${idxLabel})…`);
            const approvalResult = await signAndSubmit(approval.data);
            if (!approvalResult.success || !approvalResult.txHash) {
              const error = approvalResult.error || "Approval transaction failed.";
              setFailedOrders((prev) => [...prev, { farmerWallet, error }]);
              setGroupProgress((prev) => ({
                ...prev,
                [farmerWallet]: "error",
              }));
              continue;
            }
          }
        }

        // Step B: create_order
        const built = await createOrderWithOrderId(
          address,
          farmerWallet,
          tokenContractId,
          net,
          deadline,
        );

        if (!built.success || !built.data) {
          const error =
            built.error || "Failed to build create_order transaction.";
          setFailedOrders((prev) => [...prev, { farmerWallet, error }]);
          setGroupProgress((prev) => ({ ...prev, [farmerWallet]: "error" }));
          continue;
        }

        setProgressMessage(`Creating escrow (${idxLabel})…`);
        const builtData = built.data;
        const createResult = await signAndSubmit(builtData.txXdr);
        if (!createResult.success || !createResult.txHash) {
          const error = createResult.error || "create_order transaction failed.";
          setFailedOrders((prev) => [...prev, { farmerWallet, error }]);
          setGroupProgress((prev) => ({ ...prev, [farmerWallet]: "error" }));
          continue;
        }

        setSuccessOrders((prev) => [
          ...prev,
          {
            orderId: builtData.orderId,
            farmerWallet,
            txHash: createResult.txHash!,
          },
        ]);
        setGroupProgress((prev) => ({ ...prev, [farmerWallet]: "success" }));

        // Remove items for this farmer so a partial-failure retry doesn't
        // duplicate the orders that already succeeded.
        await Promise.all(group.items.map((it) => removeCartItem(it.id)));
        await refreshCart();
      }
    } finally {
      setRunning(false);
      setStep(3);
      setProgressMessage("Checkout complete.");
    }
  }

  const groups = cart.groups;
  const empty = groups.length === 0;

  return (
    <Sheet
      open={drawerOpen}
      onOpenChange={(next) => (next ? setDrawerOpen(true) : closeAndReset())}
    >
      <SheetContent
        side="right"
        className="flex w-full max-w-lg flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="flex items-center gap-2 text-lg">
              <ShoppingBag className="size-4" />
              Cart
              {itemCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {itemCount}
                </Badge>
              )}
            </SheetTitle>
            <StepIndicator step={step} />
          </div>
          <SheetDescription className="sr-only">
            Review items, set a delivery deadline, and create escrow orders per
            farmer.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-auto p-6">
          {cartLoading ? (
            <p className="text-muted-foreground text-sm">Loading cart…</p>
          ) : cartError ? (
            <p className="text-destructive text-sm">{cartError}</p>
          ) : empty ? (
            <EmptyCart
              onBrowse={() => {
                closeAndReset();
                router.push("/market");
              }}
            />
          ) : step === 1 ? (
            <Step1Review
              groups={groups}
              totals={totals}
              setQuantityForProduct={setQuantityForProduct}
            />
          ) : step === 2 ? (
            <Step2Confirm
              groups={groups}
              totals={totals}
              deliveryDeadline={deliveryDeadline}
              setDeliveryDeadline={setDeliveryDeadline}
              running={running}
              progressMessage={progressMessage}
              groupProgress={groupProgress}
            />
          ) : (
            <Step3Result
              successOrders={successOrders}
              failedOrders={failedOrders}
              onView={(orderId) => {
                closeAndReset();
                router.push(`/orders/${orderId}`);
              }}
            />
          )}
        </div>

        {!empty && (
          <SheetFooter className="border-t px-6 py-4">
            {step === 1 && (
              <div className="flex w-full gap-3">
                <Button
                  variant="outline"
                  onClick={() => setDrawerOpen(false)}
                  className="flex-1"
                >
                  Continue shopping
                </Button>
                <Button onClick={() => setStep(2)} className="flex-[2]">
                  Proceed to Checkout
                  <ArrowRight className="size-4" />
                </Button>
              </div>
            )}
            {step === 2 && (
              <div className="flex w-full gap-3">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  disabled={running}
                  className="flex-1"
                >
                  <ArrowLeft className="size-4" />
                  Back
                </Button>
                <Button
                  onClick={() => void createOrdersForCart(groups)}
                  isLoading={running}
                  disabled={running || !deliveryDeadline}
                  className="flex-[2]"
                >
                  {running ? "Signing…" : "Confirm & Create Escrow Orders"}
                </Button>
              </div>
            )}
            {step === 3 && (
              <div className="flex w-full gap-3">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="flex-1"
                >
                  Back to cart
                </Button>
                <Button onClick={closeAndReset} className="flex-[2]">
                  Done
                </Button>
              </div>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components

function StepIndicator({ step }: { step: 1 | 2 | 3 }) {
  const labels = ["Review", "Confirm", "Done"] as const;
  return (
    <div className="hidden items-center gap-1.5 sm:flex">
      {labels.map((label, i) => {
        const idx = (i + 1) as 1 | 2 | 3;
        const isActive = idx === step;
        const isDone = idx < step;
        return (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className={cn(
                "grid size-6 place-content-center rounded-full text-[10px] font-semibold",
                isDone && "bg-primary text-primary-foreground",
                isActive && "bg-primary/10 text-primary ring-2 ring-primary",
                !isActive && !isDone && "bg-muted text-muted-foreground",
              )}
            >
              {isDone ? <Check className="size-3" /> : idx}
            </span>
            {i < labels.length - 1 && (
              <span
                className={cn(
                  "h-px w-3",
                  isDone ? "bg-primary" : "bg-border",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function EmptyCart({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <div className="bg-muted text-muted-foreground grid size-16 place-content-center rounded-full">
        <ShoppingBag className="size-7" />
      </div>
      <h3 className="text-lg font-semibold">Your cart is empty</h3>
      <p className="text-muted-foreground text-sm">
        Browse the market and add products to start a checkout.
      </p>
      <Button onClick={onBrowse} className="mt-2">
        Browse Market
      </Button>
    </div>
  );
}

function Step1Review({
  groups,
  totals,
  setQuantityForProduct,
}: {
  groups: CartGroup[];
  totals: { gross: bigint; fee: bigint; net: bigint };
  setQuantityForProduct: (productId: string, quantity: number) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-4">
        {groups.map((g) => (
          <Card key={g.farmer_wallet}>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">
                {g.farmer_name}
              </CardTitle>
              <p className="text-muted-foreground font-mono text-xs">
                {formatTruncatedAddress(g.farmer_wallet)} ·{" "}
                <span className="font-sans">{g.currency}</span>
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {g.items.map((it) => (
                <div
                  key={it.id}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{it.name}</p>
                    <p className="text-muted-foreground text-xs">
                      {it.unit_price} {g.currency} / {it.unit}
                    </p>
                  </div>
                  <div className="bg-secondary flex items-center gap-1 rounded-full p-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 rounded-full"
                      onClick={() =>
                        setQuantityForProduct(
                          it.product_id,
                          Number(it.quantity) - 1,
                        )
                      }
                    >
                      −
                    </Button>
                    <span className="min-w-6 text-center text-sm font-medium">
                      {it.quantity}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7 rounded-full"
                      onClick={() =>
                        setQuantityForProduct(
                          it.product_id,
                          Number(it.quantity) + 1,
                        )
                      }
                    >
                      +
                    </Button>
                  </div>
                </div>
              ))}
              <Separator />
              <SubtotalRow
                gross={BigInt(g.subtotal)}
                currency={g.currency}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-secondary/40">
        <CardContent className="space-y-1.5 py-4 text-sm">
          <Row label="Subtotal" value={totals.gross.toString()} />
          <Row
            label="Platform fee (3%)"
            value={totals.fee.toString()}
            muted
          />
          <Separator className="my-2" />
          <Row label="Farmer receives" value={totals.net.toString()} bold />
        </CardContent>
      </Card>
    </div>
  );
}

function Step2Confirm({
  groups,
  totals,
  deliveryDeadline,
  setDeliveryDeadline,
  running,
  progressMessage,
  groupProgress,
}: {
  groups: CartGroup[];
  totals: { gross: bigint; fee: bigint; net: bigint };
  deliveryDeadline: string;
  setDeliveryDeadline: (v: string) => void;
  running: boolean;
  progressMessage: string;
  groupProgress: Record<string, GroupStatus>;
}) {
  return (
    <div className="space-y-5">
      <Input
        type="datetime-local"
        label="Delivery deadline"
        hint="The farmer must deliver before this time, or you can refund the escrow."
        value={deliveryDeadline}
        onChange={(e) => setDeliveryDeadline(e.target.value)}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Per-farmer escrow</CardTitle>
          <p className="text-muted-foreground text-xs">
            Each farmer in your cart settles into a separate Soroban escrow.
          </p>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {groups.map((g) => {
            const status = groupProgress[g.farmer_wallet] ?? "pending";
            return (
              <div
                key={g.farmer_wallet}
                className="flex items-center justify-between gap-3"
              >
                <span className="truncate">{g.farmer_name}</span>
                <GroupStatusBadge status={status} running={running} />
              </div>
            );
          })}
          {progressMessage && (
            <p className="text-muted-foreground border-t pt-2 text-xs">
              {progressMessage}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="bg-secondary/40">
        <CardContent className="space-y-1.5 py-4 text-sm">
          <Row label="Total locked in escrow" value={totals.net.toString()} bold />
        </CardContent>
      </Card>
    </div>
  );
}

function Step3Result({
  successOrders,
  failedOrders,
  onView,
}: {
  successOrders: OrderSuccess[];
  failedOrders: OrderFailure[];
  onView: (orderId: string) => void;
}) {
  return (
    <div className="space-y-5">
      {successOrders.length > 0 && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-primary flex items-center gap-2 text-sm">
              <Check className="size-4" />
              {successOrders.length} order
              {successOrders.length === 1 ? "" : "s"} created
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {successOrders.map((o) => (
              <div
                key={`${o.farmerWallet}-${o.orderId}`}
                className="flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">Order #{o.orderId}</p>
                  <p className="text-muted-foreground font-mono text-xs break-all">
                    {o.txHash}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onView(o.orderId)}
                >
                  View
                  <ExternalLink className="size-3.5" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {failedOrders.length > 0 && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2 text-sm">
              <X className="size-4" />
              {failedOrders.length} failed
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {failedOrders.map((f, idx) => (
              <div key={idx} className="space-y-0.5">
                <p className="font-mono text-xs">
                  {formatTruncatedAddress(f.farmerWallet)}
                </p>
                <p className="text-muted-foreground text-sm">{f.error}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function GroupStatusBadge({
  status,
  running,
}: {
  status: GroupStatus;
  running: boolean;
}) {
  if (status === "success") {
    return (
      <Badge variant="success" className="gap-1">
        <Check className="size-3" />
        Created
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="destructive" className="gap-1">
        <X className="size-3" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1">
      {running ? <Loader2 className="size-3 animate-spin" /> : null}
      Pending
    </Badge>
  );
}

function Row({
  label,
  value,
  muted,
  bold,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex justify-between",
        muted && "text-muted-foreground",
        bold && "text-base font-semibold",
      )}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function SubtotalRow({
  gross,
  currency,
}: {
  gross: bigint;
  currency: string;
}) {
  const fee = feeFromGross(gross);
  const net = gross - fee;
  return (
    <div className="space-y-1 text-xs">
      <div className="flex justify-between">
        <span className="text-muted-foreground">Subtotal</span>
        <span>
          {gross.toString()} {currency}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Fee (3%)</span>
        <span className="text-muted-foreground">
          {fee.toString()} {currency}
        </span>
      </div>
      <div className="flex justify-between font-medium">
        <span>Farmer receives</span>
        <span>
          {net.toString()} {currency}
        </span>
      </div>
    </div>
  );
}

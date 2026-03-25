"use client";

import { Container, Card, CardHeader, CardTitle, CardContent } from "@/components/ui";
import EscrowTransaction from "@/components/EscrowTransaction";
import WalletProviderWrapper from "@/components/WalletProviderWrapper";

export default function EscrowDemo() {
  // Demo data
  const demoProduct = {
    farmerAddress: "GD5DJQJ7P5DLYX6LXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2J5LYXZJ2",
    // Soroban token contract address for the asset escrowed (e.g. XLM/USDC asset contract).
    // Configure via env so on-chain contract calls don't fail.
    tokenAddress:
      process.env.NEXT_PUBLIC_TOKEN_CONTRACT_ID ?? "",
    pricePerUnit: 10.5, // 10.5 XLM per unit
    productName: "Organic Tomatoes",
  };

  return (
    <WalletProviderWrapper>
      <main className="min-h-screen bg-background text-foreground">
        <Container size="lg" className="py-8">
          <Card variant="elevated" padding="lg" className="mb-8">
            <CardHeader>
              <CardTitle>Escrow Transaction Demo</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                This is a demonstration of the escrow transaction functionality. 
                Connect your wallet and fill in the form to create a secure escrow order.
              </p>
            </CardContent>
          </Card>

          <EscrowTransaction
            farmerAddress={demoProduct.farmerAddress}
            tokenAddress={demoProduct.tokenAddress}
            pricePerUnit={demoProduct.pricePerUnit}
            productName={demoProduct.productName}
          />
        </Container>
      </main>
    </WalletProviderWrapper>
  );
}

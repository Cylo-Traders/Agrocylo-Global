export async function invest(productId: string, amount: number): Promise<void> {
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/invest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ productId, amount }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Invest request failed');
  }
}

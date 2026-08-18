import {
  getSession,
  createSession,
  updateSession,
  deleteSession,
  getWalletByPhone,
  getPhoneByWallet,
  linkPhoneToWallet,
} from "./sessionStore.js";
import { sendSms } from "./smsAdapter.js";
import { listFarmerSupplies } from "../supplyService.js";
import { OrderService } from "../orderService.js";
import { prisma } from "../../config/database.js";

const MAX_TEXT_LENGTH = 182;

function truncate(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) return text;
  return text.slice(0, MAX_TEXT_LENGTH - 3) + "...";
}

function mainMenu(): string {
  return (
    "CON Welcome to Agrocylo\n" +
    "1. List farm supply\n" +
    "2. Check order status\n" +
    "3. Confirm receipt\n" +
    "4. Link wallet\n" +
    "0. Exit"
  );
}

export async function handleUssdRequest(
  sessionId: string,
  phoneNumber: string,
  input: string,
): Promise<string> {
  let session = await getSession(sessionId);

  if (!session) {
    session = await createSession(sessionId, phoneNumber);
    return mainMenu();
  }

  await updateSession(sessionId, {});

  switch (session.step) {
    case "main_menu":
      return handleMainMenu(sessionId, input);
    case "link_wallet":
      return handleLinkWallet(sessionId, phoneNumber, input);
    case "list_supply_crop":
      return handleListSupplyCrop(sessionId, input);
    case "order_status_id":
      return handleOrderStatusId(sessionId, phoneNumber, input);
    case "confirm_receipt_id":
      return handleConfirmReceiptId(sessionId, phoneNumber, input);
    default:
      await updateSession(sessionId, { step: "main_menu" });
      return mainMenu();
  }
}

async function handleMainMenu(sessionId: string, input: string): Promise<string> {
  switch (input.trim()) {
    case "0":
      await deleteSession(sessionId);
      return "END Thank you for using Agrocylo.";
    case "1":
      await updateSession(sessionId, { step: "list_supply_crop", state: {} });
      return "CON Enter crop name (e.g., maize, rice):";
    case "2":
      await updateSession(sessionId, { step: "order_status_id", state: {} });
      return "CON Enter your Order ID:";
    case "3":
      await updateSession(sessionId, { step: "confirm_receipt_id", state: {} });
      return "CON Enter the Order ID to confirm receipt:";
    case "4":
      await updateSession(sessionId, { step: "link_wallet", state: {} });
      return "CON Enter your wallet address (0x...):";
    default:
      return "CON Invalid choice.\n" + mainMenu();
  }
}

async function handleLinkWallet(
  sessionId: string,
  phoneNumber: string,
  input: string,
): Promise<string> {
  const wallet = input.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return "CON Invalid wallet address. Enter a valid 0x address:";
  }
  await linkPhoneToWallet(phoneNumber, wallet);
  await updateSession(sessionId, { step: "main_menu", walletAddress: wallet });
  return truncate("END Wallet linked successfully!\n" + mainMenu());
}

async function handleListSupplyCrop(
  sessionId: string,
  input: string,
): Promise<string> {
  const crop = input.trim();
  if (!crop) {
    return "CON Please enter a valid crop name:";
  }

  try {
    const result = await listFarmerSupplies({ cropName: crop, page: "1", pageSize: "5" });

    if (result.items.length === 0) {
      await updateSession(sessionId, { step: "main_menu" });
      return truncate("END No supplies found for " + crop + ".\n" + mainMenu());
    }

    let response = "END Supplies for " + crop + ":\n";
    for (const s of result.items) {
      const fs = s as { farmerWallet: string; quantityAvailable: string; unit?: string | null; pricePerUnit?: string | null };
      response +=
        `- ${fs.farmerWallet.slice(0, 6)}...${fs.farmerWallet.slice(-4)}: ` +
        `${fs.quantityAvailable} ${fs.unit ?? ""} @ ${fs.pricePerUnit ?? "N/A"}\n`;
    }
    await updateSession(sessionId, { step: "main_menu" });
    return truncate(response);
  } catch (error) {
    await updateSession(sessionId, { step: "main_menu" });
    return truncate("END Error fetching supplies. Please try again.\n" + mainMenu());
  }
}

async function handleOrderStatusId(
  sessionId: string,
  phoneNumber: string,
  input: string,
): Promise<string> {
  const orderId = input.trim();
  if (!orderId) {
    return "CON Please enter a valid Order ID:";
  }

  const wallet = await getWalletByPhone(phoneNumber);
  if (!wallet) {
    await updateSession(sessionId, { step: "main_menu" });
    return truncate("END No wallet linked to this number. Use option 4 to link first.\n" + mainMenu());
  }

  try {
    const order = await OrderService.getByOrderId(orderId);
    if (!order || (order.buyerAddress !== wallet && order.sellerAddress !== wallet)) {
      await updateSession(sessionId, { step: "main_menu" });
      return truncate("END Order not found or not associated with your wallet.\n" + mainMenu());
    }

    const response =
      "END Order " + orderId + "\n" +
      `Status: ${order.status}\n` +
      `Amount: ${order.amount} ${order.token}\n` +
      `Buyer: ${order.buyerAddress.slice(0, 6)}...\n` +
      `Seller: ${order.sellerAddress.slice(0, 6)}...`;

    await updateSession(sessionId, { step: "main_menu" });
    return response;
  } catch (err) {
    await updateSession(sessionId, { step: "main_menu" });
    return truncate("END Error fetching order.\n" + mainMenu());
  }
}

async function handleConfirmReceiptId(
  sessionId: string,
  phoneNumber: string,
  input: string,
): Promise<string> {
  const orderId = input.trim();
  if (!orderId) {
    return "CON Please enter a valid Order ID:";
  }

  const wallet = await getWalletByPhone(phoneNumber);
  if (!wallet) {
    await updateSession(sessionId, { step: "main_menu" });
    return truncate("END No wallet linked to this number. Use option 4 to link first.\n" + mainMenu());
  }

  try {
    const order = await OrderService.getByOrderId(orderId);
    if (!order || order.buyerAddress !== wallet) {
      await updateSession(sessionId, { step: "main_menu" });
      return truncate("END Order not found or you are not the buyer.\n" + mainMenu());
    }

    await prisma.order.update({
      where: { orderIdOnChain: orderId },
      data: { status: "COMPLETED" },
    });

    const buyerPhone = await getPhoneByWallet(order.buyerAddress);
    const sellerPhone = await getPhoneByWallet(order.sellerAddress);

    if (buyerPhone) {
      await sendSms(buyerPhone, `Receipt confirmed for Order ${orderId}. Thank you!`);
    }
    if (sellerPhone) {
      await sendSms(sellerPhone, `Buyer confirmed receipt for Order ${orderId}. Funds will be released.`);
    }

    await updateSession(sessionId, { step: "main_menu" });
    return truncate("END Receipt confirmed for Order " + orderId + ". SMS sent to both parties.");
  } catch (err) {
    await updateSession(sessionId, { step: "main_menu" });
    return truncate("END Error confirming receipt.\n" + mainMenu());
  }
}

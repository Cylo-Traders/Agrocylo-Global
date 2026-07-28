import { prisma } from "../config/database.js";

export async function indexGovernanceEvent(
  action: string,
  data: unknown[],
  ledger: number,
  eventIndex: number,
): Promise<void> {
  const proposalId = String(data[0] ?? "");
  if (!proposalId) return;
  const sourceEventId = `${ledger}:${eventIndex}`;

  if (action === "proposed") {
    await prisma.governanceProposal.upsert({
      where: { proposalId },
      create: {
        proposalId,
        proposer: String(data[1] ?? ""),
        targetContract: String(data[2] ?? ""),
        functionName: String(data[3] ?? ""),
        status: "VOTING",
        sourceEventId,
        ledger,
      },
      update: {},
    });
    return;
  }

  if (action === "voted") {
    const support = Boolean(data[2]);
    const weight = String(data[3] ?? "0");
    await prisma.$transaction(async (tx) => {
      if (await tx.governanceVote.findUnique({ where: { sourceEventId } })) return;
      const proposal = await tx.governanceProposal.findUniqueOrThrow({
        where: { proposalId },
      });
      await tx.governanceVote.create({
        data: {
          proposalId,
          voter: String(data[1] ?? ""),
          support,
          weight,
          sourceEventId,
          ledger,
        },
      });
      await tx.governanceProposal.update({
        where: { proposalId },
        data: support
          ? { votesFor: (BigInt(proposal.votesFor) + BigInt(weight)).toString() }
          : { votesAgainst: (BigInt(proposal.votesAgainst) + BigInt(weight)).toString() },
      });
    });
    return;
  }

  const statuses: Record<string, string> = {
    queued: "QUEUED",
    executed: "EXECUTED",
    rejected: "REJECTED",
  };
  if (statuses[action]) {
    await prisma.governanceProposal.update({
      where: { proposalId },
      data: { status: statuses[action] },
    });
  }
}

export function listGovernanceProposals() {
  return prisma.governanceProposal.findMany({
    include: { votes: true },
    orderBy: { ledger: "desc" },
  });
}

export function getGovernanceProposal(proposalId: string) {
  return prisma.governanceProposal.findUnique({
    where: { proposalId },
    include: { votes: true },
  });
}

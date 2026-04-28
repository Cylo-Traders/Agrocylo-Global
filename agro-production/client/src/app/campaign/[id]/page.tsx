import { redirect } from "next/navigation";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CampaignAliasPage({ params }: Props) {
  const { id } = await params;
  redirect(`/campaigns/${id}`);
}

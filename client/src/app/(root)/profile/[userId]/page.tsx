import UserProfile from "@/components/UserProfile";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  return <UserProfile userId={userId} />;
}

import UserProfile from "@/components/UserProfile";

export default function ProfilePage({
  params,
}: {
  params: { userId: string };
}) {
  return <UserProfile userId={params.userId} />;
}

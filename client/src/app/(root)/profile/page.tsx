import { redirect } from "next/navigation";

export default function ProfileIndexPage() {
  redirect("/profile/settings");
}

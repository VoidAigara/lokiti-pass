import type { Metadata } from "next";
import { ProfileClient } from "./ProfileClient";

export const metadata: Metadata = {
  title: "Личный кабинет",
  alternates: { canonical: "/profile" },
};

export default function ProfilePage() {
  return <ProfileClient />;
}

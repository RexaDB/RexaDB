import { TeamLayout } from "@/components/team/team-layout";

export const metadata = {
  title: "Team Management",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <TeamLayout>{children}</TeamLayout>;
}

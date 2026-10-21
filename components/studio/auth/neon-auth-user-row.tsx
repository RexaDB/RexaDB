import { formatDistanceToNow } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface NeonAuthUser {
  UID: string;
  "Display name": string;
  Email: string | null;
  Providers: string;
  "Created at": string | null;
  __avatar_url?: string | null;
  __confirmed: boolean;
  __created_at_raw?: string | null;
}

function initials(name: string): string {
  return name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "U";
}

function createdLabel(value?: string | null) {
  if (!value) return { relative: "—", absolute: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { relative: "—", absolute: "" };
  return { relative: formatDistanceToNow(date, { addSuffix: true }), absolute: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date) };
}

export function NeonAuthUserRow({ user }: { user: NeonAuthUser }) {
  const created = createdLabel(user.__created_at_raw ?? user["Created at"]);
  const verifiedStyle = "border-[color-mix(in_srgb,var(--success)_25%,var(--border))] bg-[color-mix(in_srgb,var(--success)_10%,var(--card))] text-success";
  return (
    <tr className="group border-b border-border/70 transition-colors hover:bg-muted/35">
      <td className="px-5 py-3.5"><div className="flex min-w-[230px] items-center gap-3"><Avatar className="size-9"><AvatarImage src={user.__avatar_url ?? undefined} alt="" /><AvatarFallback className="text-xs font-semibold">{initials(user["Display name"] || user.Email || "User")}</AvatarFallback></Avatar><div className="min-w-0"><div className="truncate text-sm font-medium text-foreground">{user["Display name"] || "Unnamed user"}</div><div className="truncate text-xs text-muted-foreground">{user.Email || "No email address"}</div></div></div></td>
      <td className="px-5 py-3.5"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${user.__confirmed ? verifiedStyle : "border-border bg-muted text-muted-foreground"}`}><span className={`size-1.5 rounded-full ${user.__confirmed ? "bg-[color:var(--success)]" : "bg-muted-foreground/50"}`} />{user.__confirmed ? "Verified" : "Unverified"}</span></td>
      <td className="px-5 py-3.5"><span className="inline-flex items-center rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground">{user.Providers || "Email"}</span></td>
      <td className="whitespace-nowrap px-5 py-3.5 text-right" title={created.absolute}><div className="text-sm text-foreground">{created.relative}</div><div className="mt-0.5 text-xs text-muted-foreground">Joined</div></td>
    </tr>
  );
}

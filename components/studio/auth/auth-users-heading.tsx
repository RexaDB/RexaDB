import { ShieldCheck, Users } from "@/lib/icon-theme/lucide-react";

export function AuthUsersHeading({ count, neonAuth }: { count: number; neonAuth: boolean }) {
  return (
    <header className="flex items-center justify-between gap-6 border-b border-studio-border bg-studio-bg px-6 py-5">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
          <Users className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Identity</span>
            {neonAuth && <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Neon Auth</span>}
          </div>
          <div className="mt-1 flex items-baseline gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Users</h1>
            <span className="text-xs text-muted-foreground">{count} loaded</span>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{neonAuth ? "Review the people who have an account in this project." : "View and manage the people who can access your application."}</p>
        </div>
      </div>
      {neonAuth && <div className="hidden shrink-0 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground sm:flex"><ShieldCheck className="size-3.5 text-primary" />Managed by Neon</div>}
    </header>
  );
}

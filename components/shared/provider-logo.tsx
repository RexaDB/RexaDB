import { cn } from "@/lib/utils";

const LOGO_MAP: Record<string, string> = {
  postgres: "/providers/postgres.png",
  postgresql: "/providers/postgres.png",
  mysql: "/providers/mysql.png",
  mariadb: "/providers/mariadb.png",
  mongo: "/providers/MongoDB.png",
  mongodb: "/providers/MongoDB.png",
  redis: "/providers/redis.png",
  sqlite: "/providers/sqlite.png",
  turso: "/providers/Turso.png",
  clickhouse: "/providers/clickhouse.png",
  sqlserver: "/providers/sqlserver.png",
  mssql: "/providers/sqlserver.png",
  redshift: "/providers/redshift.png",
  supabase: "/providers/supabase.png",
  "supabase-mgmt": "/providers/supabase.png",
  neon: "/providers/neon.png",
  timescale: "/providers/timescale.png",
  planetscale: "/providers/planetscale.png",
  cockroachdb: "/providers/cockroachdb.png",
  yugabytedb: "/providers/yogabyte.png",
  federated: "/providers/federated.svg",
  jdbc: "/providers/jdbc.svg",
};

export function getProviderLogoUrl(type?: string | null): string {
  const key = (type || "postgres").toLowerCase();
  return LOGO_MAP[key] || "/providers/postgres.png";
}

import Image from "next/image";
import { useId } from "react";
import { Server } from "@/lib/icon-theme/lucide-react";

export function SupabaseLogo({ className }: { className?: string }) {
  const uid = useId();
  const p0 = `supabase-p0-${uid}`;
  const p1 = `supabase-p1-${uid}`;
  return (
    <span className={cn("inline-flex size-4 shrink-0 items-center justify-center", className)}>
      <svg
        viewBox="0 0 109 113"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-[78%] w-[78%]"
      >
        <path
          d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z"
          fill={`url(#${p0})`}
        />
        <path
          d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z"
          fill={`url(#${p1})`}
          fillOpacity="0.2"
        />
        <path
          d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z"
          fill="#3ECF8E"
        />
        <defs>
          <linearGradient id={p0} x1="53.9738" y1="54.974" x2="94.1635" y2="71.8295" gradientUnits="userSpaceOnUse">
            <stop stopColor="#249361" />
            <stop offset="1" stopColor="#3ECF8E" />
          </linearGradient>
          <linearGradient id={p1} x1="36.1558" y1="30.578" x2="54.4844" y2="65.0806" gradientUnits="userSpaceOnUse">
            <stop />
            <stop offset="1" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </span>
  );
}

export function NeonLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex size-4 shrink-0 items-center justify-center", className)}>
      <svg
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-[72%] w-[72%]"
      >
        <path
          fill="#37C38F"
          d="M63 0.0177909V63.5526L38.4178 42.2501V63.5526H0V0L63 0.0177909ZM7.72251 55.8389H30.6953V25.3238L55.2779 47.0476V7.72922L7.72251 7.71559V55.8389Z"
        />
      </svg>
    </span>
  );
}

export function SpacetimeDbBrandImage({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 35 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-4 shrink-0", className)}
    >
      <path
        d="M28.8002 15.317C28.5535 9.53226 29.63 6.19046 35 0L24.2649 10.9106C26.8343 14.2552 26.6051 19.0995 23.5774 22.1767C20.5498 25.2538 15.7834 25.4867 12.4925 22.8754L10.5042 24.8962L10.5116 24.9024L7.35285 28.1361C9.73784 26.7321 13.4208 27.1349 15.6425 27.3779C16.2579 27.4452 16.7611 27.5003 17.0937 27.5013C20.1371 27.6534 23.2301 26.5483 25.5544 24.186C27.9465 21.7549 29.0284 18.4965 28.8002 15.317Z"
        fill="currentColor"
      />
      <path
        d="M17.9063 4.49871C18.2389 4.49971 18.7421 4.55476 19.3575 4.62207C21.5792 4.86508 25.2622 5.26792 27.6472 3.86395L24.4884 7.0976L24.4958 7.10383L22.5075 9.12462C19.2166 6.51328 14.4502 6.74618 11.4226 9.82332C8.3949 12.9005 8.16574 17.7448 10.7351 21.0894L0 32C5.36996 25.8095 6.44651 22.4677 6.1998 16.683C5.97163 13.5035 7.05355 10.2451 9.44557 7.81402C11.7699 5.45167 14.8629 4.34657 17.9063 4.49871Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M24.7486 16C24.7486 20.0687 21.5033 23.367 17.5 23.367C13.4967 23.367 10.2514 20.0687 10.2514 16C10.2514 11.9313 13.4967 8.63292 17.5 8.63292C21.5033 8.63292 24.7486 11.9313 24.7486 16ZM17.5 21.6C20.5752 21.6 23.0682 19.0928 23.0682 16C23.0682 12.9072 20.5752 10.4 17.5 10.4C14.4248 10.4 11.9318 12.9072 11.9318 16C11.9318 19.0928 14.4248 21.6 17.5 21.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SpacetimeDbLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 35 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("size-4 shrink-0", className)}
    >
      <path
        d="M28.8002 15.317C28.5535 9.53226 29.63 6.19046 35 0L24.2649 10.9106C26.8343 14.2552 26.6051 19.0995 23.5774 22.1767C20.5498 25.2538 15.7834 25.4867 12.4925 22.8754L10.5042 24.8962L10.5116 24.9024L7.35285 28.1361C9.73784 26.7321 13.4208 27.1349 15.6425 27.3779C16.2579 27.4452 16.7611 27.5003 17.0937 27.5013C20.1371 27.6534 23.2301 26.5483 25.5544 24.186C27.9465 21.7549 29.0284 18.4965 28.8002 15.317Z"
        fill="currentColor"
      />
      <path
        d="M17.9063 4.49871C18.2389 4.49971 18.7421 4.55476 19.3575 4.62207C21.5792 4.86508 25.2622 5.26792 27.6472 3.86395L24.4884 7.0976L24.4958 7.10383L22.5075 9.12462C19.2166 6.51328 14.4502 6.74618 11.4226 9.82332C8.3949 12.9005 8.16574 17.7448 10.7351 21.0894L0 32C5.36996 25.8095 6.44651 22.4677 6.1998 16.683C5.97163 13.5035 7.05355 10.2451 9.44557 7.81402C11.7699 5.45167 14.8629 4.34657 17.9063 4.49871Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M24.7486 16C24.7486 20.0687 21.5033 23.367 17.5 23.367C13.4967 23.367 10.2514 20.0687 10.2514 16C10.2514 11.9313 13.4967 8.63292 17.5 8.63292C21.5033 8.63292 24.7486 11.9313 24.7486 16ZM17.5 21.6C20.5752 21.6 23.0682 19.0928 23.0682 16C23.0682 12.9072 20.5752 10.4 17.5 10.4C14.4248 10.4 11.9318 12.9072 11.9318 16C11.9318 19.0928 14.4248 21.6 17.5 21.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ProviderLogo({
  type,
  className,
}: {
  type?: string | null;
  className?: string;
}) {
  const key = (type || "postgres").toLowerCase();
  // Default 16px; callers pass e.g. size-4 / size-5 / size-6 for a consistent box.
  const boxClass = cn("size-4 shrink-0", className);

  if (key === "spacetimedb") {
    return <SpacetimeDbLogo className={boxClass} />;
  }
  if (key === "supabase" || key === "supabase-mgmt") {
    return <SupabaseLogo className={boxClass} />;
  }
  if (key === "neon") {
    return <NeonLogo className={boxClass} />;
  }
  const logo = LOGO_MAP[key] || "/providers/postgres.png";
  if (
    logo === "/providers/postgres.png" &&
    type &&
    type.toLowerCase() !== "postgres" &&
    type.toLowerCase() !== "postgresql"
  ) {
    return <Server className={cn(boxClass, "text-muted-foreground")} />;
  }
  return (
    <div className={cn("relative", boxClass)}>
      <Image
        src={logo}
        alt={type || "database"}
        fill
        className="object-contain rounded-sm"
        sizes="24px"
      />
    </div>
  );
}

import { cn } from '@/lib/utils';

const ENVIRONMENT_STYLES: Record<
  string,
  { label: string; tone: string; dot: string }
> = {
  production: {
    label: 'production',
    tone: 'bg-red-500/10 text-red-400 ring-red-500/20',
    dot: 'bg-red-400',
  },
  staging: {
    label: 'staging',
    tone: 'bg-amber-500/10 text-amber-400 ring-amber-500/20',
    dot: 'bg-amber-400',
  },
  local: {
    label: 'local',
    tone: 'bg-sky-500/10 text-sky-400 ring-sky-500/20',
    dot: 'bg-sky-400',
  },
};

export function EnvironmentBadge({
  environment,
  className,
}: {
  environment: string;
  className?: string;
}) {
  const style = ENVIRONMENT_STYLES[environment] ?? {
    label: environment,
    tone: 'bg-muted/40 text-muted-foreground ring-border',
    dot: 'bg-muted-foreground',
  };

  return (
    <span
      className={cn(
        'inline-flex h-4.5 shrink-0 items-center gap-1 rounded-full p-2 text-[10px] font-medium leading-none ring-1 ring-inset select-none',
        style.tone,
        className,
      )}
    >
      {style.label}
    </span>
  );
}

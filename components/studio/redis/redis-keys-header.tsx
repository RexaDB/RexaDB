"use client";

interface RedisKeysHeaderProps {
  selectedDatabase: string;
}

export function RedisKeysHeader({ selectedDatabase }: RedisKeysHeaderProps) {
  return (
    <div className="p-8 pb-4">
      <h1 className="text-sm font-semibold text-foreground tracking-tight">Redis Keys</h1>
      <p className="text-sm text-muted-foreground mt-1">
        Browse keys in <code className="bg-muted px-1 rounded">{selectedDatabase}</code>
      </p>
    </div>
  );
}

export type RedisKeyInfo = {
  key: string;
  type: string;
  ttlSeconds: number | null;
  size: number | null;
};

export type RedisKeyType = "string" | "hash" | "list" | "set" | "zset";

export type RedisCreateKeyInput = {
  key: string;
  type: RedisKeyType;
  rawValue: string;
  ttlSeconds?: number | null;
};

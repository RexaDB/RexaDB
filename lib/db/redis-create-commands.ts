import type { RedisCreateKeyInput } from "@/types/redis";

const quoteArg = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
const splitValues = (raw: string) =>
  raw.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean);

const parseHashPairs = (raw: string) => {
  const pairs = splitValues(raw).map((entry) => {
    const idx = entry.indexOf("=");
    if (idx <= 0) throw new Error("Hash values must be in field=value format.");
    return [entry.slice(0, idx), entry.slice(idx + 1)];
  });
  if (pairs.length === 0) throw new Error("Provide at least one hash field=value pair.");
  return pairs.flatMap(([field, value]) => [quoteArg(field), quoteArg(value)]).join(" ");
};

const parseZsetPairs = (raw: string) => {
  const entries = splitValues(raw).map((entry) => {
    const parts = entry.split(/\s+/);
    if (parts.length < 2) throw new Error("ZSET values must be in score member format.");
    const score = Number(parts[0]);
    if (!Number.isFinite(score)) throw new Error("ZSET score must be a number.");
    return `${score} ${quoteArg(parts.slice(1).join(" "))}`;
  });
  if (entries.length === 0) throw new Error("Provide at least one ZSET score member pair.");
  return entries.join(" ");
};

export function buildRedisCreateCommands(input: RedisCreateKeyInput) {
  const key = input.key.trim();
  if (!key) throw new Error("Key name is required.");
  const ttl = Number.isFinite(input.ttlSeconds) ? Number(input.ttlSeconds) : null;
  const commands: string[] = [];
  if (input.type === "string") {
    const value = input.rawValue.trim();
    if (!value) throw new Error("Value is required for string keys.");
    commands.push(`SET ${quoteArg(key)} ${quoteArg(value)}`);
  } else if (input.type === "hash") {
    commands.push(`HSET ${quoteArg(key)} ${parseHashPairs(input.rawValue)}`);
  } else if (input.type === "list") {
    const values = splitValues(input.rawValue);
    if (values.length === 0) throw new Error("Provide at least one list value.");
    commands.push(`RPUSH ${quoteArg(key)} ${values.map(quoteArg).join(" ")}`);
  } else if (input.type === "set") {
    const values = splitValues(input.rawValue);
    if (values.length === 0) throw new Error("Provide at least one set value.");
    commands.push(`SADD ${quoteArg(key)} ${values.map(quoteArg).join(" ")}`);
  } else {
    commands.push(`ZADD ${quoteArg(key)} ${parseZsetPairs(input.rawValue)}`);
  }
  if (ttl && ttl > 0) commands.push(`EXPIRE ${quoteArg(key)} ${ttl}`);
  return commands;
}

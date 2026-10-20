"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function NeonCreateBucketDialog({ open, onOpenChange, onCreate, busy }: { open: boolean; onOpenChange: (open: boolean) => void; onCreate: (name: string, access: "private" | "public_read") => Promise<void>; busy: boolean }) {
  const [name, setName] = useState("");
  const [access, setAccess] = useState<"private" | "public_read">("private");
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-sm"><DialogHeader><DialogTitle>New Neon bucket</DialogTitle></DialogHeader><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="bucket-name" autoFocus /><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={access === "public_read"} onChange={(e) => setAccess(e.target.checked ? "public_read" : "private")} />Public read access</label><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={busy || !name.trim()} onClick={() => void onCreate(name.trim(), access)}>{busy ? "Creating…" : "Create bucket"}</Button></DialogFooter></DialogContent></Dialog>;
}

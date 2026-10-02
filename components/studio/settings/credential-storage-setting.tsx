"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShieldCheck } from "@/lib/icon-theme/lucide-react";
import { getConnections } from "@/lib/api/actions-client";
import { getCredentialStorageMode, setCredentialStorageMode, type CredentialStorageMode } from "@/lib/credentials/local-vault";
import { toast } from "sonner";

export function CredentialStorageSetting() {
  const [mode, setMode] = useState<CredentialStorageMode>("keychain");
  const [confirmPlaintext, setConfirmPlaintext] = useState(false);
  useEffect(() => setMode(getCredentialStorageMode()), []);

  const applyMode = async (value: CredentialStorageMode) => {
    setCredentialStorageMode(value);
    setMode(value);
    setConfirmPlaintext(false);
    try {
      const connections = await getConnections();
      if (connections.some((connection: any) => connection.credentialError)) {
        toast.error("Some credentials could not be migrated or unlocked. Restore access and retry.");
      } else {
        toast.success("Credential storage updated; saved connections are being migrated.");
      }
    } catch {
      toast.error("Could not migrate saved credentials to the selected storage.");
    }
  };

  return (
    <Card className="space-y-3 border-studio-border bg-studio-bg/50 p-4">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Connection Credential Storage</h3>
          <p className="text-xs text-muted-foreground">Choose how saved passwords and tokens are protected.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={mode === "keychain" ? "secondary" : "outline"} aria-pressed={mode === "keychain"} onClick={() => void applyMode("keychain")}>System keychain</Button>
        <Button type="button" size="sm" variant={mode === "vault" ? "secondary" : "outline"} aria-pressed={mode === "vault"} onClick={() => void applyMode("vault")}>Encrypted local vault</Button>
        <Button type="button" size="sm" variant={mode === "plaintext" ? "destructive" : "outline"} aria-pressed={mode === "plaintext"} onClick={() => setConfirmPlaintext(true)}>Plaintext (unsafe)</Button>
      </div>
      <p className={`text-xs ${mode === "plaintext" ? "text-destructive" : "text-muted-foreground"}`}>
        {mode === "plaintext"
          ? "Passwords and tokens are stored unencrypted in SQLite. Anyone who can read the database, its WAL, or backups can recover them."
          : mode === "vault"
            ? "Credentials are encrypted in SQLite with Argon2id and AES-GCM. A strong passphrase is required and cannot be recovered if forgotten."
            : "Credentials are stored in the operating-system keychain; SQLite keeps only a reference. If keychain access fails, choose the encrypted vault."}
      </p>
      <p className="text-xs text-muted-foreground">Backups made before migration may still contain plaintext secrets; rotate or delete them.</p>
      <Dialog open={confirmPlaintext} onOpenChange={setConfirmPlaintext}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Store credentials in plaintext?</DialogTitle>
            <DialogDescription>
              Database passwords and tokens will be readable in sqlite.db, its write-ahead log, and new backups. Use this only if you accept that exposure.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmPlaintext(false)}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => void applyMode("plaintext")}>I understand—store in plaintext</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

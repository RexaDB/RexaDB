"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { attachVaultPrompt, lockCredentialVault, type VaultPrompt } from "@/lib/credentials/local-vault";

export function CredentialVaultPrompt() {
  const [request, setRequest] = useState<VaultPrompt | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const detach = attachVaultPrompt(setRequest);
    const lockOnClose = () => lockCredentialVault();
    window.addEventListener("beforeunload", lockOnClose);
    return () => { detach(); window.removeEventListener("beforeunload", lockOnClose); };
  }, []);

  const close = () => {
    request?.reject();
    setRequest(null);
    setPassphrase("");
    setConfirmation("");
    setError("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!request || busy) return;
    if (request.setup && passphrase.length < 12) return setError("Use at least 12 characters.");
    if (request.setup && passphrase !== confirmation) return setError("The passphrases do not match.");
    if (!passphrase) return setError("Enter the vault passphrase.");
    setBusy(true);
    request.resolve(passphrase);
    setRequest(null);
    setPassphrase("");
    setConfirmation("");
    setError("");
    setBusy(false);
  };

  return (
    <Dialog open={Boolean(request)} onOpenChange={(open) => { if (!open && request) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{request?.setup ? "Create encrypted credential vault" : "Unlock credential vault"}</DialogTitle>
          <DialogDescription>
            {request?.setup
              ? "Credentials will be encrypted in SQLite with Argon2id and AES-GCM. Choose a strong passphrase; it cannot be recovered if forgotten."
              : "Enter your vault passphrase. It stays in memory for this app session and is never saved."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="credential-vault-passphrase">Vault passphrase</Label>
            <Input id="credential-vault-passphrase" type="password" autoComplete="off" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} />
          </div>
          {request?.setup && <div className="space-y-2"><Label htmlFor="credential-vault-confirm">Confirm passphrase</Label><Input id="credential-vault-confirm" type="password" autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>}
          {(error || request?.error) && <p className="text-sm text-destructive">{error || request?.error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={busy}>{request?.setup ? "Create vault" : "Unlock"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

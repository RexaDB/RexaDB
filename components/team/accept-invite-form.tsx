"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { StudioUrlStep, AcceptInviteFields, ConnectedDoneScreen } from "@/components/shared/accept-invite";
import { acceptInvite, trimStudioUrl } from "@/components/shared/accept-invite-utils";

export function AcceptInviteForm() {
  const router = useRouter();
  const [step, setStep] = useState<"url" | "accept" | "done">("url");
  const [studioUrl, setStudioUrlState] = useState("http://localhost:3000");
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSetUrl = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = trimStudioUrl(studioUrl);
    if (!trimmed) {
      toast.error("Enter your studio backend URL");
      return;
    }
    setStudioUrlState(trimmed);
    setStep("accept");
  };

  const handleAccept = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim() || !name.trim() || !email.trim()) {
      toast.error("All fields are required");
      return;
    }
    setLoading(true);
    try {
      await acceptInvite(studioUrl, token, name, email);
      setStep("done");
      toast.success("Connected to studio!");
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to accept invite";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (step === "done") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-studio-bg">
        <Card className="w-full max-w-md p-8 text-center space-y-4 border-studio-border bg-studio-bg/80 backdrop-blur-xl">
          <ConnectedDoneScreen onDone={() => router.push("/team")} />
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-studio-bg">
      <Card className="w-full max-w-md p-6 space-y-6 border-studio-border bg-studio-bg/80 backdrop-blur-xl">
        {step === "url" ? (
          <StudioUrlStep
            studioUrl={studioUrl}
            onStudioUrlChange={setStudioUrlState}
            onSubmit={handleSetUrl}
          />
        ) : (
          <>
            <AcceptInviteFields
              token={token}
              onTokenChange={setToken}
              name={name}
              onNameChange={setName}
              email={email}
              onEmailChange={setEmail}
              loading={loading}
              onSubmit={handleAccept}
            />
            <button
              type="button"
              onClick={() => setStep("url")}
              className="text-xs text-muted-foreground hover:text-foreground w-full text-center"
            >
              Change studio URL
            </button>
          </>
        )}
      </Card>
    </div>
  );
}

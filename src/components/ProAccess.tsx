"use client";

import { type SyntheticEvent, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  fetchCredentials,
  storedCredentials,
  walletChanged,
} from "@/lib/proWallet";

const subscribe = (onChange: () => void) => {
  window.addEventListener(walletChanged, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(walletChanged, onChange);
    window.removeEventListener("storage", onChange);
  };
};

type Status =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Working" }
  | { readonly _tag: "Issued"; readonly count: number }
  | { readonly _tag: "Failed"; readonly message: string };

export function ProAccess() {
  const stored = useSyncExternalStore(subscribe, storedCredentials, () => 0);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<Status>({ _tag: "Idle" });

  const submit = async (event: SyntheticEvent) => {
    event.preventDefault();
    setStatus({ _tag: "Working" });
    try {
      setStatus({ _tag: "Issued", count: await fetchCredentials(code) });
      setCode("");
    } catch (error) {
      setStatus({
        _tag: "Failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <div className="mt-6 space-y-4 rounded-lg border border-border bg-card p-4">
      <form onSubmit={(event) => void submit(event)} className="flex gap-2">
        <input
          aria-label="Access code"
          placeholder="Access code"
          value={code}
          onChange={(event) => {
            setCode(event.target.value);
          }}
          autoComplete="off"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
        />
        <Button
          type="submit"
          disabled={code === "" || status._tag === "Working"}
        >
          {status._tag === "Working" ? "Blinding…" : "Get credentials"}
        </Button>
      </form>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Next chat session</dt>
        <dd className="font-medium">{stored > 0 ? "Pro" : "Free"}</dd>
        <dt className="text-muted-foreground">Credentials in this browser</dt>
        <dd className="font-medium">{stored}</dd>
      </dl>
      {status._tag === "Issued" && (
        <p className="text-sm">
          Stored {status.count} credentials. Wait a while before you chat, so
          getting them and first using one are not next to each other in time.
        </p>
      )}
      {status._tag === "Failed" && (
        <p role="alert" className="text-sm text-destructive">
          {status.message}
        </p>
      )}
    </div>
  );
}

"use client";

import { useActionState } from "react";
import { clientCancelAction } from "./actions";

export function CancelForm({ token, label }: { token: string; label: string }) {
  const [state, action, pending] = useActionState(clientCancelAction, undefined);
  return (
    <form action={action} className="mt-4" onSubmit={(e) => { if (!confirm(label + "?")) e.preventDefault(); }}>
      <input type="hidden" name="token" value={token} />
      {state?.error && <p className="mb-2 text-sm text-red-600">{state.error}</p>}
      <button className="btn-danger" disabled={pending}>{label}</button>
    </form>
  );
}

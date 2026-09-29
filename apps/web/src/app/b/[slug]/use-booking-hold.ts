"use client";

import { useEffect, useRef, useState } from "react";
import { acquireHoldAction, releaseHoldAction, type HoldState } from "./actions";
import type { HoldSelection } from "@/lib/booking-hold";

export function useBookingHold(selection: HoldSelection, genericError: string) {
  const key = `itckar-hold:${JSON.stringify(selection)}`;
  const [hold, setHold] = useState<HoldState | null>(null);
  const [now, setNow] = useState(Date.now);
  const [clockOffset, setClockOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  // Reuse the request during React StrictMode effect replay; do not create two holds.
  const request = useRef<{ id: string; promise: Promise<HoldState> } | null>(null);
  useEffect(() => {
    let active = true;
    const id = `${key}:${attempt}`;
    if (request.current?.id !== id) {
      let previous = "";
      try { previous = sessionStorage.getItem(key) ?? ""; } catch { /* storage may be disabled */ }
      request.current = { id, promise: acquireHoldAction(selection, previous) };
    }
    request.current.promise.then((result) => {
      if (!active) return;
      setNow(Date.now());
      setHold(result);
      if ("ticket" in result) {
        setClockOffset(result.serverNow - Date.now());
        try { sessionStorage.setItem(key, result.ticket); } catch { /* the in-memory ticket still works */ }
      }
    }).catch(() => { if (active) setHold({ error: genericError }); });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; clearInterval(timer); };
    // The key contains every selection field, including service order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt, genericError]);
  const seconds = hold && "expiresAt" in hold ? Math.max(0, Math.ceil((hold.expiresAt - (now + clockOffset)) / 1000)) : 0;
  const retry = () => { setHold(null); setAttempt((n) => n + 1); };
  const release = async () => {
    if (hold && "ticket" in hold) {
      try { await releaseHoldAction(hold.ticket); } finally {
        try { sessionStorage.removeItem(key); } catch { /* optional */ }
      }
    }
  };
  return { hold, seconds, retry, release };
}

import type { SmsProvider } from "./types";

const consoleSms: SmsProvider = {
  name: "console",
  async send(m) {
    console.log(`[sms] to=${m.to} ${m.senderId ? `from=${m.senderId} ` : ""}len=${m.text.length}\n    ${m.text}`);
    return {};
  },
};

/** BulkGate (CZ/SK gateway) simple transactional API. */
function bulkgateSms(appId: string, token: string): SmsProvider {
  return {
    name: "bulkgate",
    async send(m) {
      const r = await fetch("https://portal.bulkgate.com/api/1.0/simple/transactional", {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          application_id: appId,
          application_token: token,
          number: m.to.replace(/^\+/, ""),
          text: m.text,
          unicode: true,
          sender_id: m.senderId ? "gText" : "gSystem",
          sender_id_value: m.senderId ?? undefined,
        }),
      });
      const j = (await r.json()) as { data?: { sms_id?: string }; error?: string };
      if (!r.ok || j.error) throw new Error(`bulkgate ${r.status}: ${j.error ?? "error"}`);
      return { providerMessageId: j.data?.sms_id };
    },
  };
}

/** Twilio fallback (global). */
function twilioSms(sid: string, token: string, from: string): SmsProvider {
  return {
    name: "twilio",
    async send(m) {
      const body = new URLSearchParams({ To: m.to, From: from, Body: m.text });
      const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const j = (await r.json()) as { sid?: string; message?: string };
      if (!r.ok) throw new Error(`twilio ${r.status}: ${j.message ?? "error"}`);
      return { providerMessageId: j.sid };
    },
  };
}

export function smsProvider(): SmsProvider {
  const kind = process.env.SMS_PROVIDER ?? "console";
  if (kind === "bulkgate") {
    const id = process.env.BULKGATE_APP_ID;
    const token = process.env.BULKGATE_APP_TOKEN;
    if (!id || !token) throw new Error("BULKGATE_APP_ID and BULKGATE_APP_TOKEN are required");
    return bulkgateSms(id, token);
  }
  if (kind === "twilio") {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (!sid || !token || !from) throw new Error("TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are required");
    return twilioSms(sid, token, from);
  }
  return consoleSms;
}

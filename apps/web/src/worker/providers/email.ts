import type { EmailProvider } from "./types";

const consoleEmail: EmailProvider = {
  name: "console",
  async send(m) {
    console.log(`[email] to=${m.to} subject="${m.subject}"\n${m.text.replace(/^/gm, "    ")}`);
    return {};
  },
};

/** Resend (https://resend.com) – simple HTTPS API, EU sending domains supported. */
function resendEmail(apiKey: string, from: string): EmailProvider {
  return {
    name: "resend",
    async send(m) {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: `${m.fromName} <${from}>`, to: [m.to], subject: m.subject, text: m.text }),
      });
      if (!r.ok) throw new Error(`resend ${r.status}: ${await r.text()}`);
      const j = (await r.json()) as { id?: string };
      return { providerMessageId: j.id };
    },
  };
}

export function emailProvider(): EmailProvider {
  const kind = process.env.EMAIL_PROVIDER ?? "console";
  if (kind === "resend") {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!key || !from) throw new Error("RESEND_API_KEY and EMAIL_FROM are required for EMAIL_PROVIDER=resend");
    return resendEmail(key, from);
  }
  return consoleEmail;
}

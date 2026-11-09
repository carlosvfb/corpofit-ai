import { brand } from "./brand.js";
/**
 * E-mails transacionais via Resend (https://resend.com), se RESEND_API_KEY e MAIL_FROM estiverem definidos.
 * Sem configuração, o conteúdo é apenas registrado no console do servidor (desenvolvimento).
 */
export async function sendMail(to, subject, text) {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM;
    if (!key || !from) {
        if (process.env.NODE_ENV !== "production")
            console.info(`[mail:dev] Para: ${to}\nAssunto: ${subject}\n${text}`);
        else
            console.warn("[mail] RESEND_API_KEY/MAIL_FROM não configurados; e-mail não enviado.");
        return { sent: false };
    }
    const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject: `${subject} — ${brand.name}`, text }),
    });
    return { sent: res.ok };
}

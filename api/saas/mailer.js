import { brand } from "./brand.js";
/**
 * E-mails transacionais via Resend (https://resend.com). Exige RESEND_API_KEY e MAIL_FROM (um remetente de um domínio
 * verificado no Resend, por exemplo "CorpoFit AI <no-reply@seudominio.com.br>"). REPLY_TO é opcional.
 * Sem configuração, o conteúdo é apenas registrado no console do servidor em desenvolvimento.
 * O texto continua sendo a versão principal; a versão HTML é só a mesma mensagem com a marca.
 */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const linkify = (s) => s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#7c5cff">$1</a>');
export function renderHtml(subject, text) {
    const body = text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;line-height:1.55">${linkify(esc(p)).replace(/\n/g, "<br>")}</p>`).join("");
    return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f3fb;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1c1b22">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden">
<div style="background:linear-gradient(135deg,#5b3fe0,#7c5cff);color:#fff;padding:18px 24px;font-size:18px;font-weight:700">${esc(brand.name)}</div>
<div style="padding:24px"><h2 style="margin:0 0 14px;font-size:18px">${esc(subject)}</h2>${body}</div>
<div style="padding:14px 24px;background:#faf9ff;color:#6b6880;font-size:12px">Você recebeu este e-mail porque há uma conta na ${esc(brand.name)} com este endereço.</div>
</div></body></html>`;
}
export async function sendMail(to, subject, text, fetcher = fetch) {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.MAIL_FROM;
    if (!key || !from) {
        if (process.env.NODE_ENV !== "production")
            console.info(`[mail:dev] Para: ${to}\nAssunto: ${subject}\n${text}`);
        else
            console.warn("[mail] RESEND_API_KEY/MAIL_FROM não configurados; e-mail não enviado.");
        return { sent: false, error: "not-configured" };
    }
    const full = `${subject} — ${brand.name}`;
    try {
        const res = await fetcher("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from, to, subject: full, text, html: renderHtml(subject, text), ...(process.env.REPLY_TO ? { reply_to: process.env.REPLY_TO } : {}) }),
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
            // O motivo vem do Resend (domínio não verificado, chave inválida...). Nunca o conteúdo da mensagem nem o destinatário.
            let why = "";
            try { why = String((await res.json())?.message || "").slice(0, 200); } catch { /* sem corpo */ }
            console.warn(`[mail] Resend recusou o envio (${res.status}): ${why}`);
            return { sent: false, error: `resend-${res.status}`, detail: why };
        }
        return { sent: true };
    } catch (e) {
        console.warn("[mail] falha ao falar com o Resend:", String(e?.message || e).slice(0, 120));
        return { sent: false, error: "network" };
    }
}

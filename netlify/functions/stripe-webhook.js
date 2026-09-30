/* Stripe chiama questo indirizzo quando un cliente paga.
   Risultato: ti arriva l'email "Nuovo ordine" con il pulsante per inviarlo a CJ. */
const V = require('../lib/voltra');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Solo POST' };

  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  const firma = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!V.verificaFirmaStripe(raw, firma, V.env('STRIPE_WEBHOOK_SECRET'))) {
    return { statusCode: 400, body: 'Firma Stripe non valida' };
  }

  let evento;
  try { evento = JSON.parse(raw); } catch { return { statusCode: 400, body: 'JSON non valido' }; }

  const tipiUtili = ['checkout.session.completed', 'checkout.session.async_payment_succeeded'];
  if (!tipiUtili.includes(evento.type)) return { statusCode: 200, body: 'Evento ignorato' };

  try {
    const s = await V.sessioneCompleta(evento.data.object.id);
    if (s.payment_status !== 'paid' || !s.payment_intent) return { statusCode: 200, body: 'Non ancora pagato' };

    const o = V.datiOrdine(s);
    const stato = await V.statoCJ(o.pi);
    if (stato.email_titolare === 'inviata') return { statusCode: 200, body: 'Email già inviata' };

    const sito = (V.env('URL') || '').replace(/\/$/, '');
    const link = `${sito}/approva?pi=${encodeURIComponent(o.pi)}&t=${V.firmaLink(o.pi)}`;
    const wa = V.soloCifre(o.telefono)
      ? `https://wa.me/${V.soloCifre(o.telefono).replace(/^00/, '')}?text=${encodeURIComponent(`Ciao ${o.nome.split(' ')[0]}, sono Fabio di VOLTRA! Grazie per il tuo ordine, lo sto preparando ⚡`)}`
      : '';

    await V.inviaEmail({
      a: V.CONFIG.emailTitolare,
      rispondiA: o.email,
      oggetto: `${o.prova ? '[PROVA] ' : ''}💰 Nuovo ordine ${V.euro(o.totale, o.valuta)} – ${o.nome}`,
      html: emailTitolare(o, link, wa),
    });
    await V.salvaStatoCJ(o.pi, { email_titolare: 'inviata' });
    return { statusCode: 200, body: 'OK' };
  } catch (e) {
    console.error(e);
    // 500 = Stripe riproverà da solo più tardi
    return { statusCode: 500, body: 'Errore: ' + e.message };
  }
};

function emailTitolare(o, link, wa) {
  const e = V.esc, i = o.indirizzo;
  const riga = (k, v) => `<tr><td style="padding:10px 0;color:#6B685C;font-size:14px;border-bottom:1px solid #E4E0D2;vertical-align:top">${k}</td><td style="padding:10px 0;font-size:15px;font-weight:700;text-align:right;border-bottom:1px solid #E4E0D2">${v}</td></tr>`;
  return `<!doctype html><html><body style="margin:0;background:#F4F1E8;font-family:Arial,Helvetica,sans-serif;color:#0B0C0A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F1E8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="background:#0B0C0A;padding:22px 26px;color:#F4F1E8;font-weight:900;letter-spacing:4px;font-size:18px"><span style="background:#C6F432;color:#0B0C0A;border-radius:6px;padding:2px 8px;letter-spacing:0">⚡</span> VOLTRA</td></tr>
<tr><td style="padding:28px 26px 8px">
${o.prova ? '<div style="display:inline-block;background:#FFB020;border-radius:99px;padding:4px 12px;font-size:12px;font-weight:800;margin-bottom:12px">ORDINE DI PROVA</div>' : ''}
<div style="font-size:26px;font-weight:900;line-height:1.2">Hai un nuovo ordine! 🎉</div>
<div style="font-size:16px;color:#3B3A33;margin-top:8px">Incassato: <b style="font-size:20px;color:#0B0C0A">${V.euro(o.totale, o.valuta)}</b></div>
</td></tr>
<tr><td style="padding:12px 26px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${riga('Cliente', e(o.nome))}
${riga('Telefono', e(o.telefono || '—'))}
${riga('Email', e(o.email))}
${riga('Indirizzo', `${e(i.via)} ${e(i.via2)}<br>${e(i.cap)} ${e(i.citta)} ${e(i.provincia)} (${e(i.paese)})`)}
${riga('Acquisto', o.articoli.map(e).join('<br>'))}
${riga('Pezzi da spedire', o.pezzi)}
</table></td></tr>
<tr><td style="padding:18px 26px 6px" align="center">
<a href="${e(link)}" style="display:block;background:#C6F432;color:#0B0C0A;text-decoration:none;font-weight:900;font-size:19px;padding:20px;border-radius:99px">✅ INVIA L’ORDINE A CJ</a>
<div style="font-size:13px;color:#6B685C;margin-top:10px">Si apre la pagina di conferma: un tocco su “Conferma” e CJ spedisce al cliente.</div>
</td></tr>
${wa ? `<tr><td style="padding:10px 26px 4px" align="center"><a href="${e(wa)}" style="display:block;border:2px solid #3CD66B;color:#0B0C0A;text-decoration:none;font-weight:800;font-size:16px;padding:14px;border-radius:99px">💬 Ringrazia il cliente su WhatsApp</a></td></tr>` : ''}
<tr><td style="padding:22px 26px 26px;font-size:12px;color:#8A877B">Pagamento Stripe: ${e(o.pi)} · Non inoltrare questa email: il pulsante è personale.</td></tr>
</table></td></tr></table></body></html>`;
}

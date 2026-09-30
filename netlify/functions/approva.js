/* Pagina che si apre dal pulsante "INVIA L'ORDINE A CJ" nella email.
   - GET  (apertura del link): mostra il riepilogo e il pulsante "Conferma"
   - POST (tocco su Conferma): crea l'ordine su CJ e lo paga dal saldo CJ
   L'ordine parte SOLO con il tocco su Conferma: così i filtri antivirus delle
   email, che aprono i link da soli, non possono far partire ordini per sbaglio. */
const V = require('../lib/voltra');

exports.handler = async (event) => {
  let pi, t;
  if (event.httpMethod === 'POST') {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    const f = new URLSearchParams(raw); pi = f.get('pi'); t = f.get('t');
  } else {
    const q = event.queryStringParameters || {}; pi = q.pi; t = q.t;
  }

  if (!V.linkValido(pi, t)) {
    return V.pagina('Link non valido', `<h1>Link non valido</h1><p>Questo link non è corretto o è stato modificato. Apri il pulsante direttamente dalla email dell’ordine.</p>`, 403);
  }

  let o, stato;
  try {
    const s = await V.sessioneDaPagamento(pi);
    o = V.datiOrdine(s);
    stato = await V.statoCJ(pi);
  } catch (e) {
    return errore('Non riesco a leggere l’ordine', e.message);
  }

  // Già inviato: niente ordini doppi
  if (stato.cj_order_id) return giaInviato(o, stato);

  if (!o.pagato) {
    return V.pagina('Pagamento non completato', `<h1>Pagamento non ancora completato</h1><p>Stripe non ha ancora confermato l’incasso di questo ordine. Riprova più tardi dal pulsante nella email.</p>${V.riepilogoHTML(o)}`);
  }

  if (event.httpMethod !== 'POST') return conferma(o, pi, t);

  // ---------- POST: invio a CJ ----------
  if (stato.cj_status === 'in_corso' && Date.now() - Number(stato.cj_inizio || 0) < 120000) {
    return V.pagina('Invio in corso', `<h1>Invio già in corso…</h1><p>Hai premuto due volte: il primo invio è ancora in lavorazione. Tra un minuto riapri il link dalla email per vedere l’esito.</p>`);
  }
  await V.salvaStatoCJ(pi, { cj_status: 'in_corso', cj_inizio: Date.now() });

  try {
    const r = await V.creaOrdineCJ(o);
    await V.salvaStatoCJ(pi, {
      cj_status: 'inviato', cj_order_id: r.orderId || r.orderNumber || 'creato',
      cj_stato_ordine: r.orderStatus || '', cj_costo_usd: r.actualPayment ?? r.orderAmount ?? '',
      cj_inizio: '',
    });
    const pagato = Number(V.CONFIG.cj.pagamento) !== 3;
    return V.pagina('Ordine inviato', `
<h1>✅ Fatto! Ordine inviato a CJ</h1>
<div class="card ok">
<div class="row"><span>Ordine CJ</span><b>${V.esc(r.orderId || r.orderNumber || '—')}</b></div>
<div class="row"><span>Stato</span><b>${V.esc(r.orderStatus || '—')}</b></div>
<div class="row"><span>Pagato a CJ</span><b>${r.actualPayment != null ? '$ ' + V.esc(r.actualPayment) : (r.orderAmount != null ? '$ ' + V.esc(r.orderAmount) : '—')}</b></div>
<div class="row"><span>Hai incassato</span><b>${V.euro(o.totale, o.valuta)}</b></div>
</div>
<p>${pagato ? 'CJ ha scalato il costo dal tuo saldo e prepara la spedizione per' : 'L’ordine è su CJ ma <b>non è pagato</b>: entra nel pannello CJ → Orders e pagalo per farlo partire. Destinatario:'} <b>${V.esc(o.nome)}</b>, ${V.esc(o.indirizzo.citta)}.</p>
${o.prova ? '<p><span class="tag">Ordine di prova</span></p>' : ''}
<p>Quando CJ spedisce, il codice di tracciamento compare nel pannello CJ → Orders.</p>`);
  } catch (e) {
    await V.salvaStatoCJ(pi, { cj_status: 'errore', cj_errore: e.message, cj_inizio: '' }).catch(() => {});
    return errore('CJ non ha accettato l’ordine', e.message, o, pi, t);
  }
};

async function conferma(o, pi, t) {
  let prev = '';
  try {
    const p = await V.preventivoCJ(o);
    if (p) prev = `<div class="row"><span>Spedizione CJ (${V.esc(p.logisticName)})</span><b>$ ${V.esc(p.logisticPrice)} · ${V.esc(p.logisticAging)} giorni</b></div>`;
  } catch { /* il preventivo è solo informativo */ }
  const c = V.CONFIG.cj;
  return V.pagina('Conferma ordine', `
<h1>Inviare questo ordine a CJ?</h1>
${o.prova ? '<p><span class="tag">Ordine di prova</span></p>' : ''}
${V.riepilogoHTML(o)}
<div class="card">
<div class="row"><span>Prodotto CJ</span><b>${V.esc(c.vid || c.sku || '⚠️ da impostare in config.js')}</b></div>
<div class="row"><span>Parte da</span><b>${V.esc(c.daPaese)}</b></div>
<div class="row"><span>Spedizione</span><b>${V.esc(c.logistica || '⚠️ da impostare in config.js')}</b></div>
${prev}
<div class="row"><span>Pagamento a CJ</span><b>${Number(c.pagamento) === 3 ? 'lo fai tu dal pannello CJ' : 'automatico dal saldo CJ'}</b></div>
</div>
<form method="post" onsubmit="var b=this.querySelector('button');b.disabled=true;b.textContent='Invio in corso…';">
<input type="hidden" name="pi" value="${V.esc(pi)}"><input type="hidden" name="t" value="${V.esc(t)}">
<button class="btn" type="submit">✅ CONFERMA E SPEDISCI</button>
</form>
<p style="font-size:13px">Controlla che indirizzo e prodotto siano giusti: dopo la conferma CJ prepara subito il pacco.</p>`);
}

function giaInviato(o, s) {
  return V.pagina('Già inviato', `
<h1>👍 Questo ordine è già stato inviato a CJ</h1>
<div class="card ok">
<div class="row"><span>Ordine CJ</span><b>${V.esc(s.cj_order_id)}</b></div>
<div class="row"><span>Stato all’invio</span><b>${V.esc(s.cj_stato_ordine || '—')}</b></div>
<div class="row"><span>Costo CJ</span><b>${s.cj_costo_usd ? '$ ' + V.esc(s.cj_costo_usd) : '—'}</b></div>
</div>${V.riepilogoHTML(o)}
<p>Non serve fare altro. Per il tracciamento: pannello CJ → Orders.</p>`);
}

function errore(titolo, msg, o, pi, t) {
  const m = String(msg || '');
  let consiglio = 'Controlla i dati in config.js e le chiavi su Netlify, poi riprova.';
  if (/balance|saldo|insufficient/i.test(m)) consiglio = 'Il tuo saldo CJ non basta: ricaricalo dal pannello CJ (Wallet / Balance) e poi premi di nuovo “Riprova”.';
  else if (/logistic/i.test(m)) consiglio = 'Il metodo di spedizione non è disponibile per questo prodotto o paese: copia il nome esatto dalla scheda CJ in config.js.';
  else if (/sku|vid|product|variant/i.test(m)) consiglio = 'CJ non riconosce il prodotto: controlla lo SKU/VID in config.js.';
  else if (/token|apikey|api key|accesso/i.test(m)) consiglio = 'La chiave CJ_API_KEY su Netlify non è corretta o è scaduta.';
  const riprova = pi && t ? `<form method="post" onsubmit="this.querySelector('button').disabled=true;">
<input type="hidden" name="pi" value="${V.esc(pi)}"><input type="hidden" name="t" value="${V.esc(t)}">
<button class="btn" type="submit">🔁 Riprova</button></form>` : '';
  return V.pagina(titolo, `<h1>⚠️ ${V.esc(titolo)}</h1>
<div class="card ko"><p><b>Messaggio:</b> ${V.esc(m)}</p></div>
<p>${V.esc(consiglio)}</p>
${o ? V.riepilogoHTML(o) : ''}${riprova}
${o && V.soloCifre(o.telefono) ? `<a class="btn alt" href="https://wa.me/${V.esc(V.soloCifre(o.telefono).replace(/^00/, ''))}">💬 Avvisa il cliente su WhatsApp</a>` : ''}`, 200);
}

/* Funzioni di servizio: Stripe, CJdropshipping, email, sicurezza.
   Non serve modificare questo file. */
const crypto = require('crypto');
const CONFIG = require('./config');

const env = (k, d = '') => process.env[k] || d;
const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

/* ---------------- sicurezza ---------------- */

// Verifica che la chiamata arrivi davvero da Stripe (firma "Stripe-Signature")
function verificaFirmaStripe(rawBody, header, secret, tolleranzaSec = 300) {
  if (!header || !secret) return false;
  let t = null; const firme = [];
  header.split(',').forEach(p => {
    const i = p.indexOf('='); const k = p.slice(0, i).trim(); const v = p.slice(i + 1).trim();
    if (k === 't') t = v; if (k === 'v1') firme.push(v);
  });
  if (!t || !firme.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > tolleranzaSec) return false;
  const attesa = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  return firme.some(f => f.length === attesa.length &&
    crypto.timingSafeEqual(Buffer.from(f), Buffer.from(attesa)));
}

// Firma il link del pulsante nella email: solo chi ha la email può approvare quell'ordine
function segreto() { return env('APPROVAL_SECRET') || env('STRIPE_WEBHOOK_SECRET'); }
function firmaLink(pi) {
  if (!segreto()) throw new Error('Manca APPROVAL_SECRET / STRIPE_WEBHOOK_SECRET');
  return crypto.createHmac('sha256', segreto()).update('approva:' + pi).digest('hex').slice(0, 40);
}
function linkValido(pi, t) {
  if (!pi || !t || !/^pi_[A-Za-z0-9]+$/.test(pi)) return false;
  const giusta = firmaLink(pi);
  return t.length === giusta.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(giusta));
}

/* ---------------- Stripe ---------------- */

async function stripe(path, { method = 'GET', form } = {}) {
  const key = env('STRIPE_SECRET_KEY');
  if (!key) throw new Error('Manca la variabile STRIPE_SECRET_KEY su Netlify');
  const res = await fetch('https://api.stripe.com/v1' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + key,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('Stripe: ' + ((j.error && j.error.message) || res.status));
  return j;
}

// Trova la sessione di pagamento a partire dal pagamento (pi_...)
async function sessioneDaPagamento(pi) {
  const r = await stripe(`/checkout/sessions?payment_intent=${encodeURIComponent(pi)}&expand[]=data.line_items`);
  if (!r.data || !r.data.length) throw new Error('Ordine non trovato su Stripe');
  return r.data[0];
}
async function sessioneCompleta(id) {
  return stripe(`/checkout/sessions/${encodeURIComponent(id)}?expand[]=line_items`);
}
async function statoCJ(pi) {
  const p = await stripe('/payment_intents/' + encodeURIComponent(pi));
  return p.metadata || {};
}
async function salvaStatoCJ(pi, dati) {
  const form = {};
  Object.entries(dati).forEach(([k, v]) => { form[`metadata[${k}]`] = String(v ?? '').slice(0, 500); });
  return stripe('/payment_intents/' + encodeURIComponent(pi), { method: 'POST', form });
}

// Commissione reale trattenuta da Stripe su questo pagamento (in euro). null se non ancora disponibile.
async function commissioneStripe(pi) {
  try {
    const p = await stripe(`/payment_intents/${encodeURIComponent(pi)}?expand[]=latest_charge.balance_transaction`);
    const bt = p.latest_charge && p.latest_charge.balance_transaction;
    return bt && typeof bt === 'object' ? bt.fee / 100 : null;
  } catch { return null; }
}

// Tabella dei conti: incassato, Stripe, CJ, guadagno che resta
function conti(o, { feeStripe = null, costoCJUSD = null } = {}) {
  const c = CONFIG.conti || {};
  const cjReale = costoCJUSD != null && !isNaN(Number(costoCJUSD));
  const costoCJ = cjReale ? Number(costoCJUSD) * (c.cambioUSDinEUR || 0.9) : (c.costoCJPerPezzoEUR || 0) * o.pezzi;
  const fee = feeStripe != null ? feeStripe : o.totale * 0.015 + 0.25;
  return {
    incassato: o.totale,
    stripe: fee, stripeStimata: feeStripe == null,
    cj: costoCJ, cjReale,
    cjUSD: cjReale ? Number(costoCJUSD) : null,
    resta: o.totale - fee - costoCJ,
  };
}

// Estrae dall'ordine Stripe i dati che servono a CJ e all'email
function datiOrdine(s) {
  const cd = s.customer_details || {};
  const sh = (s.collected_information && s.collected_information.shipping_details) || s.shipping_details || {};
  const a = sh.address || cd.address || {};
  const righe = (s.line_items && s.line_items.data) || [];
  const quantitaArticoli = righe.reduce((n, r) => n + (r.quantity || 1), 0) || 1;
  const perLink = s.payment_link && CONFIG.pezziPerLink[s.payment_link];
  const pezzi = perLink ? perLink * quantitaArticoli : quantitaArticoli;
  return {
    pi: s.payment_intent,
    sessione: s.id,
    pagato: s.payment_status === 'paid',
    prova: !s.livemode,
    nome: sh.name || cd.name || '',
    email: cd.email || '',
    telefono: cd.phone || '',
    indirizzo: {
      via: a.line1 || '', via2: a.line2 || '', citta: a.city || '',
      provincia: a.state || '', cap: a.postal_code || '', paese: (a.country || 'IT').toUpperCase(),
    },
    totale: (s.amount_total || 0) / 100,
    valuta: (s.currency || 'eur').toUpperCase(),
    articoli: righe.map(r => `${r.quantity || 1} × ${r.description || 'Prodotto'}`),
    pezzi,
  };
}

/* ---------------- CJdropshipping ---------------- */

let tokenCJ = null;
async function cjToken() {
  if (tokenCJ) return tokenCJ;
  const key = env('CJ_API_KEY');
  if (!key) throw new Error('Manca la variabile CJ_API_KEY su Netlify');
  const r = await fetch(CJ_BASE + '/authentication/getAccessToken', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: key }),
  });
  const j = await r.json().catch(() => ({}));
  if (j.code !== 200 || !j.data || !j.data.accessToken) throw new Error('Accesso a CJ non riuscito: ' + (j.message || r.status));
  tokenCJ = j.data.accessToken;
  return tokenCJ;
}
async function cj(path, body) {
  const tok = await cjToken();
  const r = await fetch(CJ_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CJ-Access-Token': tok },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (j.code !== 200 || j.result === false) throw new Error('CJ: ' + (j.message || ('errore ' + r.status)));
  return j.data;
}

const UE = ['AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','FR','GR','HR','HU','IE','IT','LT','LU','LV','MT','NL','PL','PT','RO','SE','SI','SK'];
function nomePaese(code) {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch { return code; }
}

// Costo di spedizione (solo informativo, serve il VID)
async function preventivoCJ(o) {
  if (!CONFIG.cj.vid) return null;
  const lista = await cj('/logistic/freightCalculate', {
    startCountryCode: CONFIG.cj.daPaese, endCountryCode: o.indirizzo.paese, zip: o.indirizzo.cap,
    products: [{ vid: CONFIG.cj.vid, quantity: o.pezzi }],
  });
  if (!Array.isArray(lista) || !lista.length) return null;
  return lista.find(l => l.logisticName === CONFIG.cj.logistica) || null;
}

// Crea (e, con pagamento 2, paga) l'ordine su CJ
async function creaOrdineCJ(o) {
  if (!CONFIG.cj.sku && !CONFIG.cj.vid) throw new Error('Nel file config.js manca lo SKU del prodotto CJ');
  if (!CONFIG.cj.logistica) throw new Error('Nel file config.js manca il nome del metodo di spedizione CJ');
  const prodotto = CONFIG.cj.vid ? { vid: CONFIG.cj.vid } : { sku: CONFIG.cj.sku };
  const i = o.indirizzo;
  const body = {
    orderNumber: o.pi,                               // unico: evita ordini doppi
    shippingCustomerName: o.nome.slice(0, 50),
    shippingAddress: i.via.slice(0, 500),
    shippingAddress2: i.via2.slice(0, 500),
    shippingCity: i.citta.slice(0, 50),
    shippingProvince: (i.provincia || i.citta).slice(0, 50),
    shippingZip: i.cap.slice(0, 20),
    shippingCountryCode: i.paese,
    shippingCountry: nomePaese(i.paese).slice(0, 50),
    shippingPhone: o.telefono.replace(/[^\d+]/g, '').slice(0, 20),
    email: o.email.slice(0, 50),
    logisticName: CONFIG.cj.logistica,
    fromCountryCode: CONFIG.cj.daPaese,
    payType: Number(CONFIG.cj.pagamento) === 3 ? 3 : 2,
    remark: 'Ordine sito VOLTRA ' + o.pi,
    products: [{ ...prodotto, quantity: o.pezzi }],
  };
  // Spedizioni da fuori UE verso l'UE: usa l'IOSS di CJ (dogana già pagata)
  if (!UE.includes(CONFIG.cj.daPaese) && UE.includes(i.paese)) body.iossType = 3;
  if (env('CJ_SANDBOX') === '1') body.isSandbox = 1;
  return cj('/shopping/order/createOrderV2', body);
}

/* ---------------- Email (Resend) ---------------- */

async function inviaEmail({ a, oggetto, html, rispondiA }) {
  const key = env('RESEND_API_KEY');
  if (!key) throw new Error('Manca la variabile RESEND_API_KEY su Netlify');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env('EMAIL_FROM', 'VOLTRA Ordini <onboarding@resend.dev>'),
      to: [a], subject: oggetto, html,
      ...(rispondiA ? { reply_to: rispondiA } : {}),
    }),
  });
  if (!r.ok) throw new Error('Email non inviata: ' + (await r.text()));
}

/* ---------------- utilità HTML ---------------- */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = (n, v = 'EUR') => (v === 'EUR' ? '€ ' : v + ' ') + Number(n).toFixed(2).replace('.', ',');
const soloCifre = s => String(s || '').replace(/\D/g, '');

function pagina(titolo, corpo, stato = 200) {
  return {
    statusCode: stato,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    body: `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(titolo)} · VOLTRA</title>
<style>
:root{--a:#C6F432;--bg:#0B0C0A;--p:#151612;--ink:#F4F1E8;--m:#C9C5B8;--l:rgba(244,241,232,.14)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,'Segoe UI',sans-serif;padding:20px}
main{max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:18px}
.logo{font-weight:900;letter-spacing:.25em;font-size:18px}.logo span{background:var(--a);color:var(--bg);border-radius:8px;padding:2px 8px;margin-right:8px;letter-spacing:0}
h1{font-size:28px;line-height:1.15;margin:8px 0 0}
.card{background:var(--p);border:1px solid var(--l);border-radius:18px;padding:18px 20px}
.row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--l);font-size:15px}.row:last-child{border:none}
.row span{color:var(--m)}.row b{text-align:right}
.btn{display:block;width:100%;text-align:center;padding:20px;border-radius:999px;border:none;background:var(--a);color:var(--bg);font-size:19px;font-weight:900;cursor:pointer;text-decoration:none}
.btn[disabled]{opacity:.6}
.alt{background:transparent;border:1px solid var(--l);color:var(--ink);font-size:16px;font-weight:700}
.ok{border-color:var(--a)}.ko{border-color:#FF5A3C}
.tag{display:inline-block;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;background:#FFB020;color:#0B0C0A}
p{margin:0;line-height:1.6;color:var(--m)}
</style></head><body><main><div class="logo"><span>⚡</span>VOLTRA</div>${corpo}</main></body></html>`,
  };
}

function riepilogoHTML(o) {
  const i = o.indirizzo;
  return `<div class="card">
<div class="row"><span>Cliente</span><b>${esc(o.nome)}</b></div>
<div class="row"><span>Telefono</span><b>${esc(o.telefono || '—')}</b></div>
<div class="row"><span>Email</span><b>${esc(o.email)}</b></div>
<div class="row"><span>Indirizzo</span><b>${esc(i.via)} ${esc(i.via2)}<br>${esc(i.cap)} ${esc(i.citta)} ${esc(i.provincia)} (${esc(i.paese)})</b></div>
<div class="row"><span>Acquisto</span><b>${o.articoli.map(esc).join('<br>')}</b></div>
<div class="row"><span>Pezzi da spedire</span><b>${o.pezzi}</b></div>
<div class="row"><span>Incassato</span><b>${euro(o.totale, o.valuta)}</b></div>
</div>`;
}

module.exports = {
  CONFIG, env, verificaFirmaStripe, firmaLink, linkValido,
  stripe, sessioneDaPagamento, sessioneCompleta, statoCJ, salvaStatoCJ, datiOrdine, commissioneStripe, conti,
  cj, preventivoCJ, creaOrdineCJ, inviaEmail,
  esc, euro, soloCifre, pagina, riepilogoHTML,
};

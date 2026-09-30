# VOLTRA · Come attivare il negozio automatico

**Come funziona una vendita**
1. Il cliente paga su Stripe (inserisce nome, email, telefono, indirizzo).
2. A **fabio.cavalieri@libero.it** arriva l'email "💰 Nuovo ordine" con il pulsante **INVIA L'ORDINE A CJ**.
3. Tocchi il pulsante → si apre il riepilogo → tocchi **CONFERMA E SPEDISCI**.
4. CJ crea l'ordine, lo paga dal tuo **saldo CJ** e spedisce al cliente. Fatto.

Il cliente riceve in automatico la ricevuta di Stripe e vede la pagina "Grazie" del sito.

> 🔐 **REGOLA D'ORO:** le chiavi segrete (Stripe `sk_…`, `whsec_…`, CJ, Resend) NON si scrivono mai in chat, email, WhatsApp o nei file del sito. Vanno SOLO su Netlify → *Environment variables* (passo 7).

---

## 1 · Resend (le email che ti arrivano) – 5 minuti
1. Vai su **resend.com** e registrati **con fabio.cavalieri@libero.it** (importante: con l'account gratuito le email possono arrivare solo all'indirizzo con cui ti registri).
2. Menu **API Keys** → **Create API Key** → copiala e tienila da parte → sarà `RESEND_API_KEY`.

## 2 · CJdropshipping – 10 minuti
1. **Chiave API:** nel pannello CJ vai nella sezione **API** del tuo profilo (se richiesto, installa prima l'app API dal menu *Apps*) → **Add API** → copia la chiave (formato `CJ…@api@…`) → sarà `CJ_API_KEY`.
2. **Saldo:** ricarica il **Wallet / Balance** di CJ (es. 50–100 $). Ogni ordine confermato viene pagato da lì.
3. Apri la scheda del power bank scelto e annota:
   - lo **SKU** della variante (es. `CJYD123456701AZ`)
   - il **paese del magazzino** (es. `DE` Germania o `CN` Cina)
   - il **nome esatto** del metodo di spedizione verso l'Italia (es. `CJPacket Ordinary`)
4. Scrivili nel file **`netlify/lib/config.js`** (è l'unico file da modificare).

## 3 · GitHub (dove vive il sito) – 5 minuti
1. Crea un account gratuito su **github.com**.
2. **New repository** → nome `voltra` → **Private** → *Create*.
3. Clicca **uploading an existing file** e trascina **tutto il contenuto** della cartella `sito-voltra` (compresa la cartella `netlify`) → **Commit changes**.

## 4 · Netlify (mette online sito + automazione) – 5 minuti
1. Su **app.netlify.com** → **Add new project** → **Import an existing project** → **GitHub** → scegli `voltra` → **Deploy**.
2. Ti dà un indirizzo tipo `https://voltra-123.netlify.app`. Poi collega il dominio **caricaora.it**: *Domain management → Add a domain* e segui le istruzioni (va comprato prima su register.it, aruba.it o simili). Finché il dominio non è collegato, nei passi 5 e 6 usa l’indirizzo `…netlify.app` al posto di `caricaora.it`.

> ⚠️ Netlify Drop (il trascina-e-rilascia) **non** fa funzionare l'automazione: serve questo metodo con GitHub.

## 5 · Stripe (i pagamenti) – 15 minuti
Lavora prima in **modalità test** (interruttore "Test mode" in alto).
1. **Catalogo prodotti** → crea "VOLTRA Mag – 1 power bank" e "VOLTRA Mag – 2 power bank" con i tuoi prezzi.
2. **Payment Links** → crea un link per ciascuno e nelle opzioni attiva:
   - ✅ **Raccogli indirizzo di spedizione** → solo **Italia**
   - ✅ **Richiedi numero di telefono**
   - **Dopo il pagamento** → *Non mostrare la pagina di conferma* → reindirizza a `https://caricaora.it/grazie.html`
3. Copia i due indirizzi dei link (`https://buy.stripe.com/…`) e gli ID (`plink_…`) → **mandameli pure in chat**, NON sono segreti: li inserisco io nel sito e in `config.js`.
4. **Impostazioni → Email clienti** → attiva **Pagamenti riusciti** (il cliente riceve la ricevuta).
5. **Sviluppatori → Chiavi API** → copia la **chiave segreta** (`sk_test_…`) → sarà `STRIPE_SECRET_KEY`.

## 6 · Collega Stripe al sito (webhook) – 3 minuti
1. Stripe → **Sviluppatori → Webhook** → **Aggiungi destinazione / endpoint**.
2. URL: `https://caricaora.it/api/stripe-webhook`
3. Eventi: `checkout.session.completed` e `checkout.session.async_payment_succeeded`.
4. Salva e copia il **Signing secret** (`whsec_…`) → sarà `STRIPE_WEBHOOK_SECRET`.

## 7 · Inserisci le chiavi segrete su Netlify – 3 minuti
Netlify → il tuo sito → **Site configuration → Environment variables → Add a variable**:

| Nome | Valore |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` (passo 5) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (passo 6) |
| `RESEND_API_KEY` | `re_…` (passo 1) |
| `CJ_API_KEY` | la chiave CJ (passo 2) |
| `CJ_SANDBOX` | `1` ← solo durante le prove: gli ordini CJ sono finti |

Poi **Deploys → Trigger deploy → Deploy site** per attivarle.

## 8 · Prova generale
1. Apri il tuo sito → **Ordina** → paga con la carta di prova **4242 4242 4242 4242**, scadenza futura qualsiasi, CVC `123`.
2. Controlla l'email su libero.it (guarda anche nello **spam** la prima volta e segna "non è spam").
3. Tocca **INVIA L'ORDINE A CJ** → **CONFERMA E SPEDISCI** → deve comparire "✅ Fatto!".

## 9 · Vai dal vivo 🚀
1. Su Stripe spegni "Test mode" e rifai i passi **5.1–5.5 e 6** in modalità live (link, chiave `sk_live_…`, webhook nuovo `whsec_…`).
2. Su Netlify sostituisci `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` con quelle live e **cancella `CJ_SANDBOX`**.
3. Mandami i nuovi Payment Link live: li metto nel sito.

---

### Se qualcosa va storto
- **Non arriva l'email** → controlla lo spam; su Stripe → Webhook guarda se l'evento è in errore (clicca per leggere il motivo).
- **"Il tuo saldo CJ non basta"** → ricarica il saldo CJ e premi **Riprova** nella stessa pagina.
- **Ho premuto due volte** → nessun problema: il sistema blocca gli ordini doppi.
- **Voglio cambiare testi o prezzi** → modifica i file su GitHub: Netlify aggiorna il sito da solo in un minuto.

/* =====================================================================
   CONFIGURAZIONE VOLTRA  –  questo è l'UNICO file da modificare
   ---------------------------------------------------------------------
   Qui NON vanno mai le chiavi segrete (Stripe, CJ, Resend):
   quelle si inseriscono su Netlify → Site configuration → Environment variables.
   ===================================================================== */

module.exports = {

  // Dove ti arriva l'email "Nuovo ordine" con il pulsante per inviarlo a CJ
  emailTitolare: 'fabio.cavalieri@libero.it',

  // Il tuo WhatsApp (con 39 davanti, senza + e senza spazi)
  whatsappTitolare: '393895009266',

  // Il prodotto su CJdropshipping
  cj: {
    // SKU della variante CJ che vuoi spedire (lo trovi nella scheda prodotto su CJ, es. "CJYD123456701AZ")
    sku: '',

    // (facoltativo) VID della variante: se lo metti, la pagina di conferma ti mostra anche il costo di spedizione
    vid: '',

    // Paese del magazzino da cui parte il pacco: 'DE' Germania, 'CN' Cina, 'US' Stati Uniti...
    daPaese: 'CN',

    // Nome ESATTO del metodo di spedizione come appare su CJ (es. 'CJPacket Ordinary')
    logistica: '',

    // 2 = CJ incassa subito dal tuo SALDO CJ e spedisce (consigliato)
    // 3 = crea solo l'ordine su CJ, lo paghi tu a mano dal pannello CJ
    pagamento: 2,
  },

  // Per la tabella dei conti nell'email "Nuovo ordine" (sono STIME: aggiornale con i numeri veri)
  conti: {
    // Quanto paghi a CJ per 1 pezzo, spedizione verso l'Italia e IVA d'importazione comprese, in euro
    costoCJPerPezzoEUR: 25.60,
    // Cambio usato per convertire in euro il costo reale che CJ mostra in dollari dopo l'ordine
    cambioUSDinEUR: 0.90,
  },

  // Collega ogni Payment Link di Stripe al numero di power bank da spedire.
  // L'ID del link (inizia con "plink_") lo trovi su Stripe → Payment Links → apri il link.
  // Se un link non è in elenco, si spedisce 1 pezzo per ogni articolo acquistato.
  pezziPerLink: {
    // 'plink_1AbCdEfGhIjKlMn': 1,   // offerta "1 power bank"
    // 'plink_1OpQrStUvWxYzAb': 2,   // offerta "2 power bank"
  },
};

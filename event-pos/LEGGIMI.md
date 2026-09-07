# 🏪 SagraPOS — Guida Completa e Istruzioni

Benvenuto in **SagraPOS**, il software definitivo per la gestione cassa, comande e magazzino per sagre ed eventi.

---

## 🚀 UN SOLO PROGRAMMA PER TUTTI I COMPUTER

Non ci sono programmi separati per Server e Cassa Secondaria. Il programma è **lo stesso identico file per tutti i computer**:

- **Su macOS**: Fai doppio clic su 👉 `SagraPOS.command`
- **Su Windows**: Fai doppio clic su 👉 `SagraPOS.bat`

Al primo avvio, o in ogni momento, ti comparirà un menu semplice:
```text
  [1] CASSA 1 — SERVER PRINCIPALE (Questo computer gestisce database + cassa)
  [2] CASSA AGGIUNTIVA / SECONDARIA (Questo computer si collega alla Cassa 1)
  [3] Reset configurazione
```

- Sul computer principale che tieni come cassa base: scegli **1**.
- Su qualsiasi altro computer aggiuntivo: scegli **2** e inserisci l'indirizzo IP del Server (che la Cassa 1 mostra a schermo a caratteri cubitali!).
- La scelta viene **salvata automaticamente**: ai successivi avvii il programma parte da solo dopo 4-5 secondi senza che tu debba toccare nulla!

---

## 📱 COME FUNZIONA CON HOTSPOT DAL TELEFONO (Senza Wi-Fi)

Dove si fa la festa non c'è una connessione Wi-Fi o internet fisso? **Nessun problema!** SagraPOS è progettato specificamente per funzionare offline e tramite hotspot:

1. **Attiva l'Hotspot Personale sul tuo smartphone** (Android o iPhone).
2. **Connetti tutti i computer e dispositivi (PC Server, altri PC cassa, tablet o telefoni) alla rete Wi-Fi generata dal tuo smartphone**.
3. **Avvia SagraPOS sul computer Server (Cassa 1)**:
   - All'avvio leggerà automaticamente l'indirizzo IP assegnato dal telefono (solitamente comincia con `192.168.43.x` su Android o `172.20.10.x` su iPhone).
   - Lo mostrerà chiaramente nel riquadro verde.
4. **Sui computer secondari**:
   - Avvia `SagraPOS` e scegli `[2] Cassa Aggiuntiva`.
   - Inserisci l'IP mostrato dalla Cassa 1.
5. **Vuoi usare anche uno smartphone o tablet come cassa volante o schermo cucina?**
   - Apri Chrome o Safari sul telefono connesso all'hotspot.
   - Digita nella barra degli indirizzi: `http://[IP-DEL-SERVER]:3000` (es. `http://192.168.43.150:3000`).
   - La cassa si aprirà immediatamente e dialogherà in tempo reale con tutte le altre!

---

## ✨ COSA È STATO CORRETTO E TESTATO (VERSIONE DEFINITIVA)

1. **Persistenza del Carrello**: Se per sbaglio ricarichi la pagina del browser o si spegne lo schermo, il carrello **non si svuota**. Gli articoli rimangono salvati localmente finché non completi il pagamento o clicchi sul cestino.
2. **Sospesi per Cassa**: I tavoli sospesi sono ora separati per ogni singola cassa, evitando sovrapposizioni tra cassieri diversi.
3. **Note e Varianti in Cucina**: Le note degli articoli (es. "senza cipolla", "ben cotto") vengono regolarmente trasmesse alla cucina/bar e stampate sulla comanda.
4. **Stampa Diretta e Senza Dialog**: Gli scontrini e i talloncini di comanda vengono inviati direttamente alla stampante termica (USB o di rete) tramite ESC/POS senza far comparire la finestra di stampa del sistema operativo.
5. **Zero Installazioni Manuali**: Se porti la cartella su un nuovo computer, al primo avvio `SagraPOS` scarica i componenti mancanti, compila i file ed inizializza il database locale SQLite in automatico.

---

## 🛠️ REQUISITI MINIMI

- **Node.js**: versione LTS (scaricabile gratuitamente da [nodejs.org](https://nodejs.org) se non già presente).
- Qualsiasi sistema operativo (Windows 10/11, macOS Intel o Apple Silicon, Linux).
- Non è richiesta alcuna connessione a internet durante l'evento: tutto il database SQLite e il motore Socket.IO lavorano al 100% in locale.

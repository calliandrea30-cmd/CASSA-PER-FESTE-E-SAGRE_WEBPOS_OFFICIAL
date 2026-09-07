# 🏪 SagraPOS — Sistema Cassa & Punto Vendita per Sagre ed Eventi

<p align="center">
  <strong>Il software di cassa definitivo, veloce e moderno progettato per sagre, feste di paese, festival ed eventi gastronomici.</strong><br>
  <em>Funziona al 100% offline, supporta stampanti termiche senza finestre di dialogo, sincronizza più casse in tempo reale e si avvia con un solo clic su macOS e Windows.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Versione-2.0.0_Definitiva-brightgreen?style=for-the-badge" alt="Versione 2.0.0" />
  <img src="https://img.shields.io/badge/Compatibilità-macOS_%7C_Windows_%7C_Linux-blue?style=for-the-badge" alt="OS" />
  <img src="https://img.shields.io/badge/Offline-100%25_Funzionante-orange?style=for-the-badge" alt="Offline" />
  <img src="https://img.shields.io/badge/Stampa-Termica_ESC%2FPOS_Diretta-red?style=for-the-badge" alt="Stampa" />
</p>

---

## 📋 Indice dei Contenuti

- [Panoramica](#-panoramica)
- [Come Avviare SagraPOS (Guida Rapida)](#-come-avviare-sagrapos-guida-rapida)
  - [Su macOS](#-su-macos-apple)
  - [Su Windows](#-su-windows)
- [Cassa 1 (Server) vs Casse Aggiuntive (Client)](#-cassa-1-server-vs-casse-aggiuntive-client)
- [Funzionamento con Hotspot dal Telefono (Senza Wi-Fi)](#-funzionamento-con-hotspot-dal-telefono-senza-wi-fi)
- [Funzionalità Principali](#-funzionalità-principali)
  - [🛒 Cassa Vendita (POS)](#-cassa-vendita-pos)
  - [🖨️ Stampa Termica Diretta (ESC/POS)](#️-stampa-termica-diretta-escpos)
  - [🍽️ Schermo Cucina (KDS in Tempo Reale)](#️-schermo-cucina-kds-in-tempo-reale)
  - [📊 Amministrazione & Chiusura Cassa](#-amministrazione--chiusura-cassa)
- [Architettura Tecnica](#-architettura-tecnica)
- [Risoluzione Problemi Comuni](#-risoluzione-problemi-comuni)

---

## 🌟 Panoramica

**SagraPOS** è nato per risolvere i problemi tipici delle casse durante gli eventi affollati:
- **Niente blocchi e niente finestre di stampa del computer**: lo scontrino e la comanda escono all'istante appena clicchi "Paga in Contanti" o "Paga con Carta".
- **Carrello permanente a prova di errore**: se un operatore ricarica la pagina o il computer si spegne, l'ordine in corso non va perso grazie al salvataggio locale automatico.
- **Tutto in un unico programma**: non ci sono software separati per server e casse aggiuntive. Lo stesso pacchetto gestisce entrambi i ruoli.
- **Zero configurazioni manuali**: al primo avvio su qualsiasi nuovo computer, SagraPOS prepara e compila automaticamente tutto il necessario.

---

## 🚀 Come Avviare SagraPOS (Guida Rapida)

Tutti i computer utilizzano lo stesso programma. Non è richiesta nessuna installazione complessa.

### 🍏 Su macOS (Apple)
1. Apri la cartella del programma.
2. Fai doppio clic su:
   - 👉 **`SagraPOS.app`** (applicazione con icona colorata del registratore di cassa)
   - *Oppure su:* **`SagraPOS.command`**
3. Al primo avvio attendi qualche istante per la verifica automatica dei componenti.
4. Il browser si aprirà da solo sulla schermata di cassa!

### 🪟 Su Windows
1. Apri la cartella del programma.
2. Fai doppio clic su:
   - 👉 **`SagraPOS.bat`**
3. Il programma prepara tutto in automatico e apre la cassa nel tuo browser preferito.

> 💡 **Requisito Unico**: È necessario che sul computer sia presente [Node.js](https://nodejs.org) (versione LTS gratuita). Se non è presente, all'avvio ti verrà mostrato un messaggio che ti aprirà la pagina ufficiale di download.

---

## 🖥️ Cassa 1 (Server) vs Casse Aggiuntive (Client)

All'avvio, il programma ti presenterà un menu semplice con due scelte:

```text
  [1] CASSA 1 — SERVER PRINCIPALE (Questo computer gestisce database + cassa)
  [2] CASSA AGGIUNTIVA / SECONDARIA (Questo computer si collega alla Cassa 1)
  [3] Reset configurazione
```

1. **Sul computer principale della festa**: scegli **`1`**.
   - Questo computer farà da cassa attiva e da server centrale per tutte le altre.
   - Mostrerà sullo schermo il suo indirizzo di rete (es. `http://192.168.1.50:3000`).
2. **Su tutti gli altri computer o portatili aggiuntivi**: scegli **`2`**.
   - Ti verrà chiesto di inserire l'indirizzo IP mostrato dalla Cassa 1.
   - Il computer si collegherà all'istante e diventerà una cassa indipendente ma sincronizzata in tempo reale.
3. **Memoria Automatica**: la scelta viene memorizzata in `config.local.json`. Ai riavvii successivi il programma partirà da solo dopo 4 secondi senza chiederti nulla.

---

## 📱 Funzionamento con Hotspot dal Telefono (Senza Wi-Fi)

Nel luogo dell'evento non c'è una linea Wi-Fi o internet fisso? **Nessun problema!** SagraPOS è ottimizzato per funzionare completamente offline tramite l'hotspot di un normale cellulare:

1. **Attiva l'Hotspot Personale sul tuo smartphone** (Android o iPhone).
2. **Connetti tutti i dispositivi alla rete Wi-Fi generata dal cellulare**:
   - Il PC Server (Cassa 1)
   - Gli altri PC o portatili delle casse aggiuntive
   - Eventuali tablet o smartphone da usare come casse volanti o schermi per la cucina.
3. **Avvia SagraPOS sulla Cassa 1**:
   - Il sistema rileverà automaticamente l'IP dell'hotspot (es. `192.168.43.150` su Android o `172.20.10.2` su iPhone) e lo mostrerà a caratteri grandi.
4. **Collega qualsiasi altro dispositivo**:
   - Da un altro PC: avvia `SagraPOS` e scegli `[2] Cassa Aggiuntiva`.
   - Da uno smartphone o tablet: apri Safari o Chrome e digita l'indirizzo del server (es. `http://192.168.43.150:3000`).
   - Tutte le vendite, le giacenze e gli scontrini saranno sincronizzati all'istante!

---

## ✨ Funzionalità Principali

### 🛒 Cassa Vendita (POS)
- **Catalogo interattivo**: griglia prodotti suddivisa per categorie (Primi, Secondi, Bar, ecc.), con barra di ricerca istantanea e sezione *"Più Venduti"*.
- **Gestione varianti e note**: supporto per varianti prodotto (es. *Birra Bionda / Rossa*) e note di reparto/personalizzate (es. *Senza cipolla*, *Ben cotto*).
- **Controllo magazzino in tempo reale**: semaforo di disponibilità per ogni prodotto (verde, giallo per scorte basse, rosso per esaurito).
- **Tavoli sospesi**: possibilità di sospendere un ordine assegnando il nome del tavolo o del cliente, con isolamento per cassa (ogni cassiere gestisce i propri tavoli).
- **Checkout veloce**:
  - Calcolatore resto automatico con pulsanti per banconote veloci (+5€, +10€, +20€, +50€, +100€) e tasto *"Esatto"*.
  - Gestione sconti in euro (€), percentuale (%) e omaggi per singolo articolo.
  - Pagamento rapido con **Contanti** o **Carta/POS elettronico**.

### 🖨️ Stampa Termica Diretta (ESC/POS)
- **Zero finestre di dialogo**: la stampa avviene direttamente via socket verso il print-agent locale collegato alla stampante termica (USB o Ethernet di rete porta 9100).
- **Separazione automatica scontrino / cucina**:
  - Lo scontrino cliente viene stampato alla cassa con riepilogo prezzi, sconti e fondo ricevuta personalizzabile.
  - I talloncini comanda escono direttamente alla cucina o al bar con i soli articoli di competenza.
- **Ristampa e storno**: possibilità di ristampare l'intero scontrino, ristampare un singolo articolo o stornare un ordine direttamente dallo storico.

### 🍽️ Schermo Cucina (KDS in Tempo Reale)
- Accessibile su qualsiasi tablet, computer o smart TV all'indirizzo `/kds`.
- Mostra in tempo reale gli ordini in attesa di preparazione con timer visivo di attesa.
- Tasto *"PRONTO ✓"* per smarcare gli ordini completati.

### 📊 Amministrazione & Chiusura Cassa
- **Resoconto Cassa in diretta**: incasso lordo, netto, totale sconti erogati, ripartizione Contanti vs Carta, totali per reparto e quantità vendute per singolo prodotto.
- **Filtro Cassa singola o Globale**: visualizza i dati della singola postazione oppure il totale consolidato di tutta la festa.
- **Lettura X (intermedia)**: stampa un resoconto parziale senza azzerare la sessione.
- **Chiusura Z (definitiva)**: archivia la cassa, stampa il report fiscale/gestionale di chiusura e prepara una nuova sessione pulita.
- **Esportazione Excel (CSV)**: scarica con un clic il foglio Excel con il dettaglio di tutte le vendite della giornata.

---

## 🛠️ Architettura Tecnica

Il progetto è strutturato come un monorepo TypeScript moderno, leggero e modulare:

```text
CASSA-PER-FESTE-E-SAGRE_WEBPOS_OFFICIAL/
├── SagraPOS.app                <-- Avvio per macOS (con icona)
├── SagraPOS.command            <-- Script avvio per macOS
├── SagraPOS.bat                <-- Script avvio per Windows
├── COME_APRIRE.txt             <-- Istruzioni rapide per l'operatore
├── LEGGIMI.md                  <-- Guida utente approfondita
├── README.md                   <-- Documentazione tecnica ufficiale
│
├── event-pos/
│   ├── apps/
│   │   ├── api/                <-- Backend Fastify + Prisma ORM + Socket.IO (Porta 3001)
│   │   ├── web/                <-- Frontend Next.js 14 + Tailwind CSS + Zustand (Porta 3000)
│   │   ├── print-agent/        <-- Demone di stampa termica ESC/POS USB e TCP (Porta 3002)
│   │   └── launcher/           <-- Interfaccia Electron desktop multipiattaforma
│   ├── packages/
│   │   ├── shared-types/       <-- Tipi TypeScript condivisi
│   │   └── escpos-utils/       <-- Utilità di formattazione scontrini ESC/POS
│   └── _altri_script_e_backup/ <-- Archivio script secondari e configurazioni Docker
```

- **Database**: SQLite locale memorizzato in locale (`dev.db` o `pos.db`). Non richiede nessun server SQL esterno (PostgreSQL o MySQL) ed è al 100% indipendente da connessioni internet.
- **Sincronizzazione**: WebSocket in tempo reale via Socket.IO.

---

## ❓ Risoluzione Problemi Comuni

| Situazione | Causa probabile | Soluzione |
|---|---|---|
| **La cassa secondaria dice "Offline"** | I due computer non sono sulla stessa rete o l'IP è errato | Verifica che entrambi i PC siano connessi alla stessa rete Wi-Fi (o allo stesso Hotspot) e ricontrolla l'IP della Cassa 1. |
| **La stampante non stampa lo scontrino** | Stampante spenta, cavo USB staccato o configurazione mancante | Accendi la stampante, vai su *Amministrazione → Setup → Stampanti* e premi *"Stampa di Prova"*. |
| **Voglio cambiare modalità da Server a Cassa Secondaria** | È rimasta la configurazione del giorno prima | Avvia `SagraPOS`, premi `3` (Reset) e scegli la nuova modalità. |
| **Porta 3000 o 3001 già occupata** | Un'istanza precedente è rimasta aperta in background | Gli script di avvio liberano automaticamente le porte ad ogni avvio. Chiudi la finestra e riavvia `SagraPOS`. |

---

## 📄 Licenza & Diritti

Sviluppato per la gestione professionale di eventi, feste campestri, sagre patronali e festival enogastronomici.  
Distribuito per uso libero e personalizzabile per associazioni, pro loco e comitati organizzatori.

# SagraPOS — Guida Rapida

## Come avviare

### Su macOS / Linux

**Server Principale (Cassa 1)**  
Doppio clic su → `SagraPOS.command`

**Casse Aggiuntive**  
Doppio clic su → `AVVIA_CASSA_AGGIUNTIVA.command`

### Su Windows

**Server Principale (Cassa 1)**  
Doppio clic su → `AVVIA_CASSA_1_SERVER.bat`

**Casse Aggiuntive**  
Doppio clic su → `AVVIA_CASSA_AGGIUNTIVA.bat`

---

## Prima volta su ogni computer

### Server Principale
1. Doppio clic su `SagraPOS.command` (Mac) o `AVVIA_CASSA_1_SERVER.bat` (Windows)
2. Attendi qualche minuto la prima volta (installa dipendenze)
3. Il browser si apre automaticamente su `http://localhost:3000`
4. Vai su **Admin → Setup** per vedere l'indirizzo da dare alle altre casse

### Casse Aggiuntive
1. Assicurati che il SERVER sia già avviato
2. Doppio clic su `AVVIA_CASSA_AGGIUNTIVA.command` (Mac) o `.bat` (Windows)
3. Inserisci l'IP del server quando chiesto (es. `192.168.1.10`)
4. La configurazione viene salvata — la prossima volta parte da solo
5. Nel browser, scegli la tua stazione dall'elenco

---

## Requisiti

| | Server | Cassa Aggiuntiva |
|---|---|---|
| **Node.js** | ✅ Necessario | ✅ Necessario |
| **Connessione** | Rete locale Wi-Fi o LAN | Stessa rete del server |
| **Browser** | Aperto automaticamente | Aperto automaticamente |

**Scarica Node.js** (gratis): https://nodejs.org — scegli la versione **LTS**

---

## Struttura interna

```
event-pos/
├── SagraPOS.command          ← Avvia tutto (macOS)
├── AVVIA_CASSA_1_SERVER.bat  ← Avvia server (Windows)
├── AVVIA_CASSA_AGGIUNTIVA.*  ← Avvia cassa client
├── apps/
│   ├── api/                  ← Server database e API
│   ├── web/                  ← Interfaccia cassa (browser)
│   ├── print-agent/          ← Gestione stampante
│   └── launcher/             ← App Electron (icona desktop)
```

---

## Problemi comuni

**"La cassa dice Offline"**  
→ Controlla che il server sia acceso e che siano sulla stessa rete Wi-Fi

**"Nessun evento trovato"**  
→ Vai su `http://[ip-server]:3000/admin` e configura l'evento

**"Stampante non stampa"**  
→ Verifica che la stampante sia accesa e configurata in Admin → Setup → Stazioni

**Porta già in uso**  
→ I script fermano automaticamente i processi precedenti prima di riavviare

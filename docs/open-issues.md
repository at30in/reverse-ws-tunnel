# Problemi Aperti — v1.1.0

> Documento generato il 2026-08-25. Elenco dei rischi residui e problemi noti dopo le modifiche di backpressure/buffering.
>
> **Aggiornamento 2026-08-26**: RWT-KNOWN-012 (duplicate cleanup destroys existing tunnel resources) è stato risolto. Vedere STABILITY_CONTRACT.md per i dettagli.

---

## 🔴 Rischio HIGH

### 1. Idle timeout TCP non applicato

**Problema**: `tcpIdleTimeoutMs` (60s) è definito in `tunnelLimits.js` ma **mai usato nel codice runtime**.

**Impatto**: Se il target non risponde o il client si disconnette senza chiudere il socket, il socket TCP rimane aperto indefinitamente → leak di risorse (file descriptor, memoria).

**Dove applicare**:
- `server/tcpServer.js` ~riga 32: aggiungere `socket.setTimeout(limits.tcpIdleTimeoutMs)` dopo `ensureConn()`
- `client/tunnelClient.js` ~riga 301: aggiungere `client.setTimeout(limits.tcpIdleTimeoutMs)` in `createTcpClient()`

**Soluzione**:
```javascript
// server/tcpServer.js - dopo ensureConn(tunnel)
socket.setTimeout(limits.tcpIdleTimeoutMs);
socket.on('timeout', () => {
  logger.warn(`TCP idle timeout for uuid=${uuid}`);
  socket.destroy();
});

// client/tunnelClient.js - in createTcpClient()
client.setTimeout(limits.tcpIdleTimeoutMs);
client.on('timeout', () => {
  logger.warn(`Target TCP idle timeout for uuid=${uuid}`);
  client.destroy();
});
```

**Stato**: Non fixato. Fix semplice, alto impatto.

---

### 2. ws library buffer senza cap rigido

**Problema**: `applyWsBufferGuard()` è intenzionalmente un no-op. Il ws library non ha un `maxBufferedAmount` configurato.

**Impatto**: Se la pausa/resume del backpressureSender fallisce (es. bug, race condition), il buffer interno del ws library cresce senza limiti → OOM.

**Mitigazione attuale**: Il sender pausa il socket TCP a 8MB per-stream. In teoria sufficiente, ma nessuna safety net.

**Soluzione proposta**: Ripristinare un `maxBufferedAmount` generoso come safety net:
```javascript
// utils/backpressureSender.js
function applyWsBufferGuard(ws, limits) {
  try {
    // Safety net: 16× il highWatermark (128MB default)
    // Se superato, il ws library distrugge il socket
    ws.maxBufferedAmount = limits.highWatermarkBytes * 16;
  } catch (_) {}
}
```

**Trade-off**: Con il no-op attuale, un buffer grande non distrugge il socket. Con la safety net, un buffer troppo grande causa la chiusura forzata della connessione. Questo è preferibile a un OOM silenzioso.

**Stato**: Non fixato. Richiede valutazione del trade-off.

---

## 🟡 Rischio MEDIUM

### 3. http-parser-js sincrono

**Problema**: `http-parser-js` è un parser puro JS. Per payload molto grandi (upload senza chunking), il parsing è sincrono e blocca l'event loop.

**Impatto**: Event loop lag durante il parsing di body grandi. Con payload di 1MB+ in un singolo chunk TCP, il parser impiega tempo misurabile.

**Mitigazione**: I chunk TCP sono tipicamente 64KB-256KB (dipende dal kernel). Per la maggior parte dei casi d'uso non è un problema.

**Soluzione a lungo termine**: Sostituire `http-parser-js` con `llhttp` (nativo) o un parser streaming. Complessità alta.

**Stato**: Noto, non fixato. Accettabile per ora.

---

### 4. Limite per-process non enforced

**Problema**: In `streamWriteQueue.js` righe 89-94, quando il buffer totale supera `maxBufferPerProcessBytes` (512MB), viene solo loggato un warning. Nessun overflow viene generato.

**Impatto**: Con molti tunnel attivi, la memoria può superare 512MB senza alcuna azione correttiva. Il per-tunnel cap (256MB) mitiga ma non elimina il risico.

**Soluzione**:
```javascript
// streamWriteQueue.js - riga 89
if (totalBuffered + payload.length > limits.maxBufferPerProcessBytes) {
  logger.warn(`[buffer_limit_reached] scope=process ...`);
  return overflow('process');  // invece di solo log
}
```

**Trade-off**: Enforced il limite potrebbe chiudere stream legittimi se il processo ha molti tunnel. Il warn-only è più conservativo.

**Stato**: Non fixato. Dipende dalla tolleranza alle chiusure impreviste.

---

### 5. FrameSizeError lascia il parser corrotto

**Problema**: Dopo un `FrameSizeError`, il `FrameParser` ha un interno stato corrotto (il commento lo dice esplicitamente). Ma il ws non viene terminato immediatamente — usa `ws.close(1009)` che è asincrono.

**Impatto**: Tra la chiamata a `ws.close()` e l'effettiva chiusura, altri messaggi possono arrivare e essere processati dal parser corrotto → dati sporchi o crash.

**Soluzione**:
```javascript
// server/websocketServer.js - linea 93
ws.terminate();  // invece di ws.close(1009, ...)

// client/tunnelClient.js - linea 153
ws.terminate();  // invece di ws.close(1009, ...)
```

**Stato**: Non fixato. Fix semplice, basso rischio.

---

### 6. Nessun limite agli stream concorrenti

**Problema**: Non c'è un limite al numero di connessioni TCP concorrenti per tunnel. Ogni connessione crea un `conn` object con queue, sender, UUID.

**Impatto**: Un attacco o spike di traffico può aprire migliaia di connessioni, consumando file descriptor e memoria per gli oggetti JS (anche se i buffer sono limitati).

**Soluzione**: Aggiungere `maxStreamsPerTunnel` in `tunnelLimits.js` e controllarlo in `tcpServer.js` prima di registrare la connessione.

**Stato**: Non fixato. Rilevante solo per scenari di sicurezza.

---

### 7. WS stall per 35-45 secondi

**Problema**: Se il WS si blocca (rete silenziosa, half-open TCP), il timeout heartbeat impiega 30s (ping) + 5s (pong) = 35s per il server, o 45s per il client (health monitor).

**Impatto**: Durante lo stall, fino a 8MB × N stream di dati vengono bufferizzati ma non consegnati. Dopo il timeout, tutti gli stream vengono chiusi.

**Mitigazione attuale**: Il backpressureSender limita a 8MB per-stream. Con 10 stream → 80MB max bufferizzati durante lo stall.

**Stato**: Accettabile. Il timeout è necessario per non chiudere connessioni legittimamente lente.

---

## 🟢 Rischi LOW (già gestiti)

| # | Problema | Stato |
|---|---------|-------|
| 8 | Loop di messaggi sincrono | Gestito da bounded queue |
| 9 | Coalescer sincrono (Buffer.concat) | Limitato a 64KB |
| 10 | Deadlock sender + queue | Gestito da reconcile (30s) |
| 11 | Riconnessione durante transfer | Testato (T-G) |
| 12 | Connessioni orfane dopo disconnect | Pulite correttamente |
| 13 | Double close event sul ws | Guard nel codice |
| 14 | CLOSE message perso se WS già chiuso | Timeout gestisce |
| 15 | FrameParser tail memory leak | GC gestisce |
| 16 | async non awaited in messageHandler | Errori gestiti internamente |

---

## Priorità di fix

| Priorità | # | Fix | Complessità |
|----------|---|-----|-------------|
| **P0** | 1 | Applicare idle timeout ai socket TCP | Bassa |
| **P1** | 5 | terminate() dopo FrameSizeError | Bassa |
| **P1** | 2 | Safety net ws.maxBufferedAmount | Bassa |
| **P2** | 4 | Enforce per-process limit | Bassa |
| **P2** | 6 | maxStreamsPerTunnel | Media |
| **P3** | 3 | Sostituire http-parser-js | Alta |

---

## Test mancanti

| Test | Copertura attuale | Manca |
|------|-------------------|-------|
| 10×50MB concorrenti (consumer lenti) | T-B testa 10×8MB | Test con consumer lenti |
| Socket idle timeout | Nessun test | Test che verifica la chiusura dopo timeout |
| FrameSizeError recovery | wireCompat testa il parsing | Test che verifica chiusura ws dopo errore |
| Max streams per tunnel | Nessun test | Test che verifica il limite |

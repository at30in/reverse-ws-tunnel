# End-to-End Encryption (E2EE) — Design Document

**Version**: 1.0-draft  
**Date**: 2026-08-30  
**Status**: Piano di implementazione  
**Compliance target**: NIS2 (EU 2022/2555), CIR 2024/2690 Annex 9

---

## 1. Executive Summary

Questo documento descrive l'architettura per introdurre End-to-End Encryption (E2EE) nella libreria `@remotelinker/reverse-ws-tunnel`. L'obiettivo è che **il server non possa leggere il contenuto dei dati transitanti** — solo il client (agent) detiene la chiave di decifratura. Il server si limita a instradare i frame basandosi sul `tunnelId` in chiaro.

### 1.1 Motivazione

- **NIS2 Compliance**: L'Articolo 21(2)(h) richiede crittografia dei dati in transito e a riposo secondo lo "state of the art"
- **Threat model**: L'operatore del server è un adversario — non deve poter leggere headers HTTP, body, o risposte
- **Zero-trust transport**: Anche con `wss://`, il server vede il plaintext dopo il TLS termination
- **Client-driven**: E2EE è opzionale — il client determina se abilitarla, il server si adatta

### 1.2 Riepilogo architetturale

```
Browser ──[E2EE]──> Server (routing only) ──[E2EE]──> Client (decrypt) ──> Target
   │                    │                                 │
   │  chiffra con       │  vede solo tunnelId             │  decifra con
   │  public key        │  + uuid + tipo                  │  private key
   │                    │  payload = BLOB opaco            │
```

---

## 2. Threat Model

### 2.1 Attori

| Attore | Capacità | Obiettivo |
|--------|----------|-----------|
| **Server operator** | Accesso completo al server, memoria, log, WS frames | Leggere dati HTTP transitanti |
| **Network observer** | Intercettazione rete (già mitigato da wss://) | Leggere dati in transito |
| **Man-in-the-middle** | Intercept + modify | Modificare o iniettare dati |

### 2.2 Cosa il server NON deve poter vedere

- HTTP method, URL, headers (incluse credenziali Authorization, Cookie)
- HTTP body (request e response)
- Contenuto delle risposte dal target
- Dati applicativi bidirezionali

### 2.3 Cosa il server DEVE poter vedere

- `tunnelId` (per instradamento frame)
- `uuid` (per identificazione stream)
- `type` byte (per distinguere CONFIG/DATA/PING/PONG)
- Frame length (per framing binario)
- Messaggi CONFIG (per setup tunnel — contengono porte, non dati sensibili)

---

## 3. Analisi architetturale attuale

### 3.1 Data flow attuale (senza E2EE)

```
1. Browser ──TCP──> server/tcpServer.js
   - HTTP parser estrae tunnelId da header/cookie
   - Ricostruisce raw HTTP headers
   - Inoltra headers + body come payload DATA frame

2. server/tcpServer.js ──WS──> client/tunnelClient.js
   - Frame: [4B length][36B tunnelId][36B uuid][1B type][payload]
   - payload = raw HTTP request (headers + body)

3. client/tunnelClient.js ──TCP──> target service
   - Scrive payload direttamente sul socket TCP
```

### 3.2 Componenti che vedono il plaintext

| Componente | Vede plaintext? | Motivo |
|-----------|-----------------|--------|
| `server/tcpServer.js` | **SI** | HTTP parser per estrazione tunnelId + body coalescing |
| `utils/backpressureSender.js` | **SI** | Wrappa payload in frame |
| `utils/frameParser.js` | **SI** | Deserializza frame |
| `client/tunnelClient.js` | **SI** | Inoltra payload al target |

### 3.3 vincoli architetturali per E2EE

1. **tunnelId nel frame header deve restare in chiaro** — il server lo usa per routing
2. **Il message type byte deve restare in chiaro** — il server distingue CONFIG/DATA/PING/PONG
3. **Il CONFIG payload deve restare in chiaro** — il server legge TARGET_PORT per setup
4. **Il CLOSE speciale (5 byte "CLOSE")** deve essere gestito criticamente
5. **L'HTTP parser del server NON può funzionare** se gli headers sono cifrati

---

## 4. Design options

### 4.1 Option A: Payload-only encryption

```
Browser ──[HTTP headers in chiaro + body cifrato]──> Server ──> Client ──> Target
```

- Headers HTTP visibili al server (tunnelId, URL, Authorization)
- Solo il body è cifrato
- Server può fare HTTP parsing normalmente

**Pro**: Minime modifiche, backward compatible  
**Contro**: Headers con credenziali esposti all'operatore del server  
**NIS2**: Non conforme — i dati sensibili negli headers sono esposti

### 4.2 Option B: Full HTTP encryption con routing metadata in chiaro (SCCELTO)

```
Browser ──[tunnelId in chiaro + HTTP request cifrato]──> Server ──> Client ──> Target
```

- Server vede SOLO tunnelId (routing), uuid, tipo
- Intera richiesta HTTP (headers + body) cifrata end-to-end
- Server NON fa HTTP parsing — tratta payload come blob opaco
- Client decifra e gestisce HTTP localmente

**Pro**: Massima privacy, server zero-knowledge, NIS2 conforme  
**Contro**: Server perde body coalescing, chunked TE re-framing, HTTP inspection  
**Complessità**: Media-alta

### 4.3 Option C: Full TCP passthrough cifrato

```
Browser ──[bytes grezzi cifrati]──> Server ──> Client ──> Target
```

- Nessun framing applicativo — bytes TCP grezzi cifrati
- Massima flessibilità, minima compatibilità
- Richiede protocollo custom per multiplexing

**Pro**: Massima flessibilità  
**Contro**: Rompe compatibilità HTTP, complessità elevata  
**NIS2**: Conforme ma eccessivo per il caso d'uso

### 4.4 Scelta consigliata: Option B

Option B bilancia sicurezza e fattibilità. Il server perde le ottimizzazioni HTTP (body coalescing, chunked TE) ma mantiene il routing. Per NIS2, la perdita delle ottimizzazioni HTTP è accettabile a fronte della protezione dei dati.

---

## 5. Cryptographic Design

### 5.1 Algoritmi (NIS2/CIR 2024/2690 compliant)

| Componente | Algoritmo | Standard | Libreria consigliata | Note |
|-----------|-----------|----------|---------------------|------|
| Key exchange | X25519 (ECDH) | NIST SP 800-56A, FIPS 203 | `@noble/curves` | Forward secrecy |
| Key derivation | HKDF-SHA256 | NIST SP 800-56C | `@noble/hashes` | Da shared secret a data key |
| Symmetric encryption | AES-256-GCM | FIPS 197, NIST SP 800-38D | `@noble/ciphers` | Authenticated encryption |
| Hashing | SHA-256 | FIPS 180-4 | `@noble/hashes` | Per integrity check |
| Random generation | `crypto.randomBytes()` | NIST SP 800-90A | `node:crypto` | CSPRNG di Node.js |

### 5.2 Key lifecycle

```
                    CONFIG handshake
Browser ◄──────────────────────────────────► Client
         ──── [publicKey] ────►
         ◄─── [config ack] ───
         
         Derivation:
         sharedSecret = X25519(browserPrivKey, clientPubKey)
         dataKey = HKDF(sharedSecret, salt="rwt-e2ee-v1", info="data-encryption")
         
         Per-frame:
         nonce = 8-byte counter (big-endian, per-stream)
         ciphertext, tag = AES-256-GCM(key=dataKey, nonce=nonce, plaintext=payload)
```

### 5.3 Frame format E2EE

```
Frame DATA con E2EE:
┌──────────────┬──────────────┬──────────────┬──────────┬─────────────────────────────┐
│ 4B length    │ 36B tunnelId │ 36B uuid     │ 1B type  │ Payload (cifrato)           │
│ (in chiaro)  │ (in chiaro)  │ (in chiaro)  │ 0x02     │ [16B tag][N nonce][ciphertext│
└──────────────┴──────────────┴──────────────┴──────────┴─────────────────────────────┘

Frame CONFIG: NON cifrato (server deve leggere TARGET_PORT, etc.)
Frame APP_PING/PONG: NON cifrato (server deve gestire heartbeat)
Frame DATA CLOSE: cifrato (5 bytes "CLOSE" dopo cifratura)
```

### 5.4 Nonce management

- Ogni stream (uuid) ha un contatore indipendente a 8 byte
- Contatore parte da 0 per ogni nuova connessione TCP
- Overflow del contatore (2^64 frame) richiede renegotiation — practically impossible
- Il contatore è incluso nel ciphertext (nonce implicito dal protocollo)

### 5.5 Key rotation

- La chiave di sessione è derivata durante il CONFIG handshake
- Validità: durata della connessione WS
- Riconnessione WS → nuovo key exchange automatico
- Nessuna persistenza della chiave su disco (solo in memoria)

---

## 6. Architettura implementativa

### 6.1 Nuovi componenti

```
utils/
  e2ee.js              — Crypto engine (key gen, encrypt, decrypt, derive)
  
client/
  encryptionProxy.js   — Local HTTP proxy che cifra le richieste
  
server/
  tcpServer.js         — Modificato: bypass HTTP parsing con E2EE abilitato
  
config/
  e2ee.config.toml     — Configurazione E2EE (abilitato/disabilitato, chiavi)
```

### 6.2 Modifiche ai componenti esistenti

| Componente | Modifica | Impatto |
|-----------|----------|---------|
| `server/tcpServer.js` | Aggiunta modalità "opaque payload" — bypass HTTP parser, forward raw bytes | Alto |
| `server/messageHandler.js` | Storage della public key del client durante CONFIG | Basso |
| `client/tunnelClient.js` | Key exchange durante CONFIG, encrypt/decrypt nei DATA frame | Medio |
| `client/utils.js` | `buildMessageBuffer` accetta payload cifrato | Basso |
| `utils/frameParser.js` | Nessuna modifica — opera su frame già decifrati lato client | Nessuno |
| `utils/backpressureSender.js` | Nessuna modifica — opera su payload opachi | Nessuno |

### 6.3 Flusso dettagliato con E2EE

#### Setup (CONFIG handshake)

```
1. Client genera coppia di chiavi X25519
   - privateKey = crypto.generateKeyPairSync('x25519')
   - publicKey = privateKey.publicKey

2. Client invia CONFIG con public key:
   {
     TARGET_PORT: 52541,
     TUNNEL_ENTRY_PORT: 3032,
     e2ee: {
       enabled: true,
       algorithm: "x25519",
       publicKey: "<base64-encoded SPKI>"
     }
   }

3. Server riceve CONFIG:
   - Legge TUNNEL_ENTRY_PORT (in chiaro)
   - Estrae e2ee.publicKey
   - Crea TCP server in modalità "opaque" (no HTTP parsing)
   - Memorizza publicKey nel tunnel state

4. Browser si connette alla entry port:
   - Deve conoscere la public key del client (pre-configurata o ricevuta via canale sicuro)
   - Browser NON è il client del tunnel — è il consumatore del servizio
   
   NOTA: Il browser ha bisogno della public key per cifrare.
   Opzioni per distribuire la public key al browser:
   a) Pre-configurata nel browser/applicazione
   b) Esposta come endpoint HTTPS sul server (meta-dati, non dati sensibili)
   c) Scambiata via canale separato (es. JWT firmato)
```

#### Data flow con E2EE

```
1. Browser cifra la richiesta HTTP:
   - plaintext = raw HTTP request (method + URL + headers + body)
   - ciphertext = AES-256-GCM(dataKey, nonce, plaintext)
   - Invia: [tunnelId in chiaro] + [ciphertext + tag]

2. Server riceve sulla TCP entry port:
   - SENZA E2EE: parser HTTP → estrae tunnelId → ricostruisce raw HTTP → frame
   - CON E2EE: legge tunnelId dai primi byte → wraps remaining bytes come payload DATA frame
   - Il server NON vede il contenuto HTTP

3. Server invia DATA frame su WS:
   - Frame: [length][tunnelId][uuid][0x02][encrypted_payload]
   - Il ws.send() trasmette il blob opaco

4. Client riceve DATA frame:
   - FrameParser deserializza: { tunnelId, uuid, type, payload }
   - type === DATA → decripta payload con AES-256-GCM
   - plaintext = raw HTTP request
   - Crea/usa TCP connection al target, scrive plaintext

5. Target risponde:
   - Client riceve TCP data
   - Cifra la response con la stessa dataKey (nonce diverso)
   - Invia DATA frame cifrato al server
   - Server inoltra al browser (che decripta)
```

---

## 7. Configurazione

### 7.1 Modello di controllo: E2EE è client-driven

**E2EE è opzionale e il client determina se abilitarla.** Il server non impone mai la cifratura — si adatta alla decisione del client.

- **Default**: E2EE **disabilitato** — comportamento attuale, nessuna modifica
- **Abilitazione**: Solo il client può attivare E2EE nella sua configurazione
- **Il server**: Se il client non richiede E2EE, il server opera in modalità plaintext
- **Il server**: Se il client richiede E2EE ma il server non lo supporta, il client opera in plaintext (backward compatible)
- **Nessun obbligo**: Il server non deve essere configurato con E2EE — è il client che decide

Questo modello garantisce:
1. **Zero-downtime migration**: Deployare il server senza E2EE, poi abilitare client per client
2. **Backward compatibility**: Client vecchi continuano a funzionare in plaintext
3. **Semplicità operativa**: Il server non ha bisogno di chiavi crittografiche né configurazione E2EE
4. **Sicurezza su misura**: Ogni client può scegliere il livello di protezione necessario

### 7.2 Variabili d'ambiente RWT_* (lato server — opzionali)

Il server NON richiede configurazione E2EE. Queste variabili sono opzionali e servono solo se il server deve supportare E2EE per client che lo richiedono:

```toml
# Abilita supporto E2EE lato server (default: false)
# Se false, il server ignora il campo e2ee nei CONFIG dei client
# NOTA: Anche se true, il server NON può decifrare — vede solo metadata
RWT_E2EE_SUPPORTED = "true"

# Log level crittografico (per audit NIS2)
RWT_E2EE_LOG_LEVEL = "info"
```

### 7.3 Configurazione client (config.toml) — il client decide

**E2EE è una decisione del client.** Il client abilita o disabilita E2EE nella sua configurazione locale. Il server si adatta automaticamente:

```toml
[encryption]
# Abilita E2EE per questo client (default: false)
# Il server verrà informato durante CONFIG handshake
# Se il server non supporta E2EE, il client opera in plaintext
enabled = true

# Algoritmo key exchange (default: x25519)
algorithm = "x25519"

# Algoritmo symmetric encryption (default: aes-256-gcm)
cipher = "aes-256-gcm"

# Salt per HKDF (obbligatorio se enabled = true)
hkdf_salt = "rwt-production-salt-v1"

# Il client genera automaticamente la key pair all'avvio
# La public key viene inviata al server durante CONFIG
```

**Flusso di negoziazione:**
```
1. Client legge la propria configurazione (config.toml o env vars)
2. Se encryption.enabled = true:
   - Genera coppia di chiavi X25519
   - Invia CONFIG con campo e2ee { enabled: true, publicKey: "..." }
3. Se encryption.enabled = false (default):
   - Invia CONFIG senza campo e2ee
   - Opera in plaintext come sempre
4. Server riceve CONFIG:
   - Se vede campo e2ee.enabled = true E supporta E2EE:
     → Modalità opaque (no HTTP parsing)
   - Se non vede campo e2ee O non supporta E2EE:
     → Modalità HTTP parsing normale
```

### 7.3 Configurazione browser/consumer

Il browser (o l'applicazione consumatrice) ha bisogno della public key per cifrare. Questa può essere:

1. **Pre-configurata** nell'applicazione (consigliato per massima sicurezza)
2. **Esposta** via endpoint HTTPS sul server: `GET /tunnel/{tunnelId}/public-key`
3. **Inclusa** in un JWT firmato distribuito via canale separato

---

## 8. Backward compatibility

### 8.1 E2EE è opzionale — il client determina l'abilitazione

| Scenario | Chi decide | Risultato |
|---------|-----------|-----------|
| **Client E2EE disabilitato** (default) | Client | Plaintext — comportamento attuale |
| **Client E2EE abilitato, server supporta** | Client | E2EE completo |
| **Client E2EE abilitato, server NON supporta** | Client | Fallback a plaintext |
| **Server E2EE supportato, client disabilitato** | Client | Plaintext |

**Principio fondamentale**: Il server non impone mai E2EE. È il client che sceglie se cifrare i propri dati.

### 8.2 Modalità operative

| Modalità | Configurazione | Comportamento |
|---------|----------------|---------------|
| **Disabled** (default) | `RWT_E2EE_ENABLED=false` | Comportamento attuale, nessuna modifica |
| **Server-only** | Server E2EE, client no | Server prepara opaque mode ma client non cifra — errore di configurazione |
| **Full E2EE** | Entrambi abilitati | Modalità cifrata completa |
| **Negotiated** | Configurato su entrambi | Il CONFIG handshake negozia E2EE — fallback a plaintext se il client non supporta |

### 8.3 Negotiated mode (consigliato)

Il CONFIG handshake negozia E2EE. Il server si adatta alla decisione del client:

```javascript
// Lato server — messageHandler.js
function handleCONFIG(payload) {
  const config = JSON.parse(payload);
  
  // Il client decide se abilitare E2EE
  const e2eeRequested = config.e2ee?.enabled === true;
  const e2eeSupported = RWT_E2EE_SUPPORTED === 'true';
  
  if (e2eeRequested && e2eeSupported) {
    // Modalità opaque — no HTTP parsing
    tunnel.e2ee = {
      enabled: true,
      publicKey: config.e2ee.publicKey
    };
  } else {
    // Modalità plaintext — HTTP parsing normale
    tunnel.e2ee = null;
    
    if (e2eeRequested && !e2eeSupported) {
      logger.warn(`[e2ee] Client richiede E2EE ma server non lo supporta — plaintext`);
    }
  }
}
```

### 8.4 Migration strategy

Il modello client-driven permette una migrazione zero-downtime:

1. **Fase 1**: Rilasciare server con supporto E2EE (`RWT_E2EE_SUPPORTED=true`)
   - Il server supporta E2EE ma nessun client lo usa — tutto in plaintext
2. **Fase 2**: Abilitare E2EE sui client uno alla volta
   - Ogni client decide se abilitare — il server si adatta automaticamente
   - Nessun downtime, nessun riavvio server
3. **Fase 3**: Monitorare e verificare compliance NIS2
   - Audit log delle sessioni E2EE attive
   - Verifica che i dati sensibili siano cifrati
4. **Fase 4** (opzionale): Deprecare modalità plaintext
   - Configurare i client per richiedere E2EE obbligatorio
   - Il server può loggare warning per client in plaintext

---

## 9. NIS2 Compliance Mapping

### 9.1 Articolo 21(2)(h) — Crittografia

| Requisito NIS2 | Implementazione | Status |
|----------------|-----------------|--------|
| Crittografia dei dati in transito | AES-256-GCM su payload DATA | ✓ |
| Key management documentato | Key lifecycle in e2ee.js con logging | ✓ |
| State of the art | X25519 + AES-256-GCM (NIST/ENISA aligned) | ✓ |
| Algoritmi approvati | Nessun algoritmo deprecato (no DES, RC4, MD5) | ✓ |
| Forward secrecy | ECDH con ephemeral keys per sessione | ✓ |

### 9.2 CIR 2024/2690 Annex 9 — Key Management

| Lifecycle Stage | Implementazione |
|-----------------|-----------------|
| **Generation** | `crypto.generateKeyPairSync('x25519')` + `crypto.randomBytes()` per salt |
| **Distribution** | Public key via CONFIG (non sensibile); private key non esposta mai |
| **Storage** | Solo in memoria del processo; nessuna persistenza su disco |
| **Rotation** | Automatica ad ogni riconnessione WS |
| **Revocation** | Chiusura WS revoca automaticamente la sessione |
| **Destruction** | `crypto.destroy()` su chiavi; garbage collection Node.js |
| **Logging** | Log di generazione, handshake, errore decifratura |

### 9.3 Audit logging

```javascript
// Esempio di audit log per operazioni crittografiche
logger.info('[e2ee] key_generated', {
  tunnelId,
  algorithm: 'x25519',
  publicKeyFingerprint: sha256(publicKey).slice(0, 16),
  timestamp: Date.now()
});

logger.info('[e2ee] session_established', {
  tunnelId,
  cipher: 'aes-256-gcm',
  kex: 'x25519',
  timestamp: Date.now()
});

logger.warn('[e2ee] decryption_failed', {
  tunnelId,
  uuid,
  reason: 'auth_tag_mismatch',
  timestamp: Date.now()
});
```

---

## 10. Implementazione — Fasi

### Fase 1: Crypto Engine (`utils/e2ee.js`)

**Lavoro**:
- Installare dipendenze: `npm install @noble/curves @noble/ciphers @noble/hashes`
- Modulo `e2ee.js` con:
  - `generateKeyPair()` → { privateKey, publicKey }
  - `deriveSharedSecret(privateKey, publicKey, salt, info)` → dataKey
  - `encrypt(key, plaintext, aad?)` → { ciphertext, tag, nonce }
  - `decrypt(key, ciphertext, tag, nonce, aad?)` → plaintext
  - `computeFingerprint(publicKey)` → hex string (per audit log)
- Usare `@noble/*` per le operazioni crittografiche (API sicure per design)
- Usare `node:crypto` solo per `randomBytes()` (CSPRNG)
- Test unitari per ogni funzione

**Test**: `__tests__/e2ee.test.js` — encrypt/decrypt roundtrip, key gen, fingerprint, error cases

### Fase 2: Server opaque mode (`server/tcpServer.js`)

**Lavoro**:
- Aggiungere modalità "opaque" a `startTCPServer()`:
  - Quando `tunnel.e2ee.enabled === true`, il TCP server NON usa HTTPParser
  - Legge tunnelId dai primi N byte (formato: `[tunnelId][encrypted_payload]`)
  - Wrappa il payload in DATA frame senza parsing HTTP
  - Rimuove body coalescing e chunked TE re-framing in modalità E2EE
- Modificare `messageHandler.js`:
  - Durante CONFIG, se `e2ee.enabled`, memorizza `e2ee.publicKey` nel tunnel state
  - TCP server viene creato in modalità opaque

**Test**: `__tests__/e2eeServer.test.js` — opaque mode routing, fallback a HTTP parsing

### Fase 3: Client E2EE (`client/tunnelClient.js`)

**Lavoro**:
- Durante CONFIG handshake:
  - Genera coppia di chiavi X25519
  - Invia public key nel payload CONFIG
  - Deriva dataKey da shared secret
- Per ogni DATA frame in uscita (TCP → WS):
  - Cifra payload con AES-256-GCM
  - Invia frame con payload cifrato
- Per ogni DATA frame in entrata (WS → TCP):
  - Decifra payload con AES-256-GCM
  - Inoltra plaintext al target
- Gestione errori: decryption failure → log + chiudi stream

**Test**: `__tests__/e2eeClient.test.js` — encrypt/decrypt roundtrip via WS mock

### Fase 4: Browser encryption proxy (`client/encryptionProxy.js`)

**Lavoro**:
- Proxy HTTP locale che:
  - Riceve HTTP request dal browser
  - Cifra il payload con la public key del client
  - Invia al tunnel entry port in modalità opaque
- Configurazione: public key del client, tunnelId, entry port
- Supporto HTTP/1.1 e WebSocket upgrade

**Test**: `__tests__/encryptionProxy.test.js` — proxy roundtrip, error handling

### Fase 5: Integration tests

**Lavoro**:
- Test end-to-end:
  - Browser → encrypt proxy → server (opaque) → client (decrypt) → target
  - Verifica che il server NON può leggere il plaintext
  - Test backward compatibility (E2EE disabled)
  - Test negotiated mode
  - Test key rotation (WS reconnect)
  - Test decryption failure handling

**Test**: `__tests__/integration/e2ee.integration.test.js`

### Fase 6: Documentation & audit

**Lavoro**:
- Aggiornare `STABILITY_CONTRACT.md` con invarianti E2EE
- Aggiornare `README.md` con sezione E2EE
- Creare `docs/e2ee-architecture.md`
- Aggiornare `CHANGELOG.md`
- Audit log review per NIS2 compliance

---

## 11. Rischio e mitigazioni

### 11.1 Rischio: Performance

- **Impatto**: AES-256-GCM ha overhead ~2-5% su payload grandi
- **Mitigazione**: Hardware AES-NI su CPU moderne; benchmark prima del rilascio
- **Monitoraggio**: Metriche `e2ee_encrypt_latency_ms`, `e2ee_decrypt_latency_ms`

### 11.2 Rischio: Backward compatibility

- **Impatto**: Client vecchi non supportano E2EE
- **Mitigazione**: Negotiated mode con fallback a plaintext; feature flag
- **Test**: Integration test con modalità mista

### 11.3 Rischio: Key management

- **Impatto**: Chiavi in memoria possono essere esposte via memory dump
- **Mitigazione**: `crypto.destroy()` su chiavi; durata limitata alla sessione WS
- **NIS2**: Documentare la procedura di key destruction

### 11.4 Rischio: HTTP parsing rimosso

- **Impatto**: Server non può fare body coalescing, chunked TE re-framing
- **Mitigazione**: Accettabile per NIS2 — il server non deve leggere i dati
- **Nota**: Le ottimizzazioni HTTP si applicano solo in modalità plaintext

### 11.5 Rischio: Browser key distribution

- **Impatto**: Il browser ha bisogno della public key
- **Mitagione**: Multiple opzioni (pre-config, endpoint HTTPS, JWT)
- **Consiglio**: Pre-configurazione per massima sicurezza

### 11.6 Rischio: Dipendenze crittografiche

- **Impatto**: Aggiungere librerie `@noble/*` aumenta superficie di attacco
- **Mitigazione**: Librerie auditate da Cure53 (2023), zero dipendenze trasitive, self-contained
- **NIS2**: Audit disponibili come evidenza documentabile per compliance
- **Alternativa**: `node:crypto` (OpenSSL) — zero nuove dipendenze ma API più esposta a errori

---

## 12. Dipendenze aggiuntive

### 12.1 Approccio: node:crypto (built-in) vs Librerie dedicate

Per sicurezza e stabilità, l'implementazione può beneficiare dell'uso di **librerie crittografiche Node.js già esistenti e auditate**, anziché implementare tutto ex-novo su `node:crypto`. Le opzioni:

#### Opzione A: `node:crypto` (built-in, nessuna dipendenza)

- Wrappa OpenSSL (libreria C battle-tested, FIPS 140-2 certificata)
- Nessuna dipendenza esterna
- API verbosa e low-level
- **Rischio**: Errori di utilizzo dell'API (es. nonce reuse, tag mancante)

```javascript
const crypto = require('node:crypto');
const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
```

#### Opzione B: `@noble/curves` + `@noble/ciphers` (consigliato per NIS2)

Librerie pure-JS, auditate, tree-shakeable, con API sicure per design:

| Libreria | Scopo | Versione | Audit |
|----------|-------|----------|-------|
| `@noble/curves` | X25519, ECDH, Ed25519 | ^1.6.0 | Cure53 (2023) |
| `@noble/ciphers` | AES-256-GCM, ChaCha20 | ^1.1.0 | Cure53 (2023) |
| `@noble/hashes` | SHA-256, HKDF, PBKDF2 | ^1.5.0 | Cure53 (2023) |

**Vantaggi per NIS2:**
- **Audit indipendenti**: Cure53 ha auditato le librerie noble — documento di audit disponibile
- **API sicure per design**: Impossibile usare chiavi senza inizializzazione, nonce obbligatorio
- **Zero dipendenze trasitive**: Ogni libreria è single-file, nessun `node_modules` tree
- **Tree-shakeable**: Solo le funzioni usate entrano nel bundle
- **FIPS-aligned**: Implementano gli stessi algoritmi di OpenSSL ma con API più sicura

```javascript
import { x25519 } from '@noble/curves/ed25519';
import { aes256gcm } from '@noble/ciphers/aes';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';

// Key generation
const privateKey = x25519.utils.randomPrivateKey();
const publicKey = x25519.getPublicKey(privateKey);

// Key derivation
const dataKey = hkdf(sha256, sharedSecret, salt, { info: 'rwt-e2ee-v1', dkLen: 32 });

// Encryption (API impossibile da usare male)
const cipher = aes256gcm(dataKey);
const ciphertext = cipher.encrypt(nonce, plaintext, associatedData);
const plaintext = cipher.decrypt(nonce, ciphertext, associatedData);
```

#### Opzione C: `jose` (per JWT/JWK se necessario)

- Standard JOSE (JSON Object Signing and Encryption)
- Utile se la key distribution al browser usa JWT
- Completa la catena di fiducia per NIS2

### 12.2 Raccomandazione

| Scenario | Scelta consigliata |
|----------|-------------------|
| **Massima semplicità, zero dipendenze** | `node:crypto` |
| **NIS2 compliance, audit documentato** | `@noble/curves` + `@noble/ciphers` + `@noble/hashes` |
| **Key distribution via JWT** | Aggiungere `jose` |

**Per NIS2, si consiglia Opzione B** (`@noble/*`): audit indipendenti disponibili, API sicure per design, zero dipendenze trasitive. L'audit di Cure53 fornisce evidenza documentabile per la compliance.

### 12.3 Dipendenze totali (Opzione B)

```json
{
  "@noble/curves": "^1.6.0",
  "@noble/ciphers": "^1.1.0",
  "@noble/hashes": "^1.5.0"
}
```

**Nessuna dipendenza trasitiva** — ogni libreria è self-contained.

### 12.4 Confronto dimensioni

| Pacchetto | Dimensione | Dipendenze trasitive |
|-----------|------------|---------------------|
| `@noble/curves` | ~45KB minified | 0 |
| `@noble/ciphers` | ~12KB minified | 0 |
| `@noble/hashes` | ~25KB minified | 0 |
| **Totale** | ~82KB | **0** |

Per confronto, `node:crypto` richiede OpenSSL (~3MB) ma è già incluso in Node.js.

---

## 13. Metriche E2EE

```javascript
// Nuove metriche da aggiungere a TunnelMetrics
e2ee_sessions_total: gauge       // Sessioni E2EE attive
e2ee_encrypt_total: counter      // Payload cifrati
e2ee_decrypt_total: counter      // Payload decifrati
e2ee_decrypt_errors_total: counter // Errori decifratura (attacchi?)
e2ee_key_rotations_total: counter  // Rotazioni chiave (riconnessioni)
e2ee_encrypt_latency_ms: histogram // Latenza cifratura
e2ee_decrypt_latency_ms: histogram // Latenza decifratura
```

---

## 14. File da modificare/creare

### 14.1 Nuovi file

| File | Descrizione |
|------|-------------|
| `utils/e2ee.js` | Crypto engine (key gen, derive, encrypt, decrypt) |
| `__tests__/e2ee.test.js` | Test unitari crypto engine |
| `__tests__/e2eeServer.test.js` | Test server opaque mode |
| `__tests__/e2eeClient.test.js` | Test client encrypt/decrypt |
| `__tests__/integration/e2ee.integration.test.js` | Test end-to-end |
| `docs/e2ee-architecture.md` | Documento architettura E2EE |

### 14.2 File da modificare

| File | Modifica | Complessità |
|------|----------|-------------|
| `server/tcpServer.js` | Modalità opaque (bypass HTTP parser) | Alta |
| `server/messageHandler.js` | Storage public key durante CONFIG | Bassa |
| `server/state.js` | Aggiungere campo `e2ee` al tunnel state | Bassa |
| `client/tunnelClient.js` | Key exchange + encrypt/decrypt DATA frame | Media |
| `utils/tunnelLimits.js` | Aggiungere limiti E2EE | Bassa |
| `utils/tunnelMetrics.js` | Aggiungere metriche E2EE | Bassa |
| `utils/loadConfig.js` | Aggiungere opzioni E2EE | Bassa |
| `STABILITY_CONTRACT.md` | Invarianti E2EE | Bassa |
| `README.md` | Documentazione E2EE | Bassa |
| `CHANGELOG.md` | Entry E2EE | Bassa |

---

## 15. Timeline stimata

| Fase | Durata | Dipendenze |
|------|--------|------------|
| Fase 1: Crypto engine | 2-3 giorni | Nessuna |
| Fase 2: Server opaque | 3-4 giorni | Fase 1 |
| Fase 3: Client E2EE | 3-4 giorni | Fase 1 |
| Fase 4: Encryption proxy | 2-3 giorni | Fase 3 |
| Fase 5: Integration tests | 2-3 giorni | Fasi 2-4 |
| Fase 6: Documentation | 1-2 giorni | Fasi 2-5 |
| **Totale** | **13-19 giorni** | |

---

## 16. Aperti / Da decidere

1. **Browser key distribution**: Quale meccanismo per distribuire la public key al browser? (pre-config vs endpoint HTTPS vs JWT)
2. **Post-quantum readiness**: Valutare hybrid X25519 + ML-KEM-768 per forward-looking compliance?
3. **Nonce storage**: Il contatore nonce per stream deve essere persistito per crash recovery o è accettabile perderlo?
4. **Error reporting**: Come riportare decryption failures al browser senza esporre informazioni sull'attacco?
5. **Performance baseline**: Benchmark prima dell'implementazione per baseline metriche
6. **Audit formale**: È richiesto un audit crittografico formale per NIS2?

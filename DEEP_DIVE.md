# Deep Dive: Bridle Agentic Wallet Platform

## Overview

Bridle is a prototype multi-agent autonomous wallet platform built on Solana for the [Superteam Nigeria DeFi Developer Challenge](https://superteam.fun/earn/listing/defi-developer-challenge-agentic-wallets-for-ai-agents). It demonstrates how AI agents can independently create wallets, manage funds, make trading decisions, and execute transactions without human intervention.

This document covers the design decisions, security architecture, AI integration, and how the system components interact. It serves as the written deep dive required by the bounty.

---

## 1. Wallet Design

### The Problem

For AI agents to act as autonomous participants in the Solana ecosystem, they need wallets they fully control. Unlike human-managed wallets, agentic wallets must:

- Be created programmatically without manual key generation
- Sign transactions automatically based on AI decisions
- Hold funds securely even though no human oversees day-to-day operations
- Operate within safety boundaries to prevent catastrophic losses

### Why One Keypair Per Agent?

Each agent gets its own Solana keypair. This is a deliberate design choice:

- **Isolation** — A compromised agent cannot access another agent's funds. The blast radius of any security incident is limited to a single wallet.
- **Auditability** — Each wallet has its own on-chain transaction history. You can verify every trade an agent made by querying the Solana explorer with its public key.
- **Scalability** — Agents are fully independent with no shared state contention. Spawning a new agent is a single API call.
- **Policy enforcement** — Per-agent spending limits, daily caps, and cooldowns are enforced at the wallet level.

### Key Generation

We use `@solana/web3.js`'s `Keypair.generate()` which creates Ed25519 keypairs using a cryptographically secure random number generator (CSPRNG). The keypair exists in memory only long enough to be encrypted — the plaintext secret key is never written to disk, logged, or transmitted over the network.

### Encrypted Key Storage

The encryption pipeline for each agent's secret key:

```mermaid
flowchart TD
    SK["Secret Key (64 bytes)"] --> PBKDF2
    subgraph PBKDF2["PBKDF2 Key Derivation"]
        PW["Password from .env"]
        SALT["Random Salt (32B)"]
        ITER["100k iterations, SHA-512"]
    end
    PBKDF2 --> DK["Derived Key (32B)"]
    DK --> AES
    subgraph AES["AES-256-GCM Encryption"]
        IV["Random IV (16B)"]
        TAG["Auth Tag (16B)"]
    end
    AES --> CT["Ciphertext"]
    CT --> FILE["Stored as JSON in data/keys/agentId.enc"]
```

**Key design choices:**

- **PBKDF2 with 100,000 iterations** of SHA-512 makes brute-force attacks computationally expensive. At 10,000 guesses/second, testing just 1 billion passwords would take ~27 hours.
- **Unique salt per key** prevents rainbow table attacks. Even if two agents have the same secret key, the encrypted output is completely different.
- **AES-256-GCM** provides both confidentiality (encryption) and authenticity (tamper detection). If someone modifies the ciphertext, decryption will fail rather than producing a corrupted key.
- **Unique IV per encryption** ensures that re-encrypting the same key produces different ciphertext, preventing pattern analysis.
- **Secure deletion** overwrites key files with random data before unlinking from the filesystem, preventing recovery from disk.

### Encrypted Key File Format

Each agent's key is stored as a JSON file in `data/keys/{agentId}.enc`:

```json
{
  "iv": "hex-encoded 16-byte initialization vector",
  "salt": "hex-encoded 32-byte random salt",
  "authTag": "hex-encoded 16-byte GCM authentication tag",
  "encrypted": "hex-encoded ciphertext of the 64-byte secret key"
}
```

---

## 2. Security Considerations

### Threat Model

| Threat | Mitigation | Risk Level |
|--------|------------|------------|
| Key theft from disk | AES-256-GCM encryption with PBKDF2-derived keys | Low |
| Key exposure in memory | Keys decrypted only during signing, immediately discarded | Medium |
| Runaway agent spending | PolicyGuard enforces per-trade and daily limits | Low |
| Unauthorized tokens | Token whitelist prevents interactions with unknown contracts | Low |
| Trade flooding | Configurable cooldown periods between trades | Low |
| Audit tampering | Append-only JSONL log files (no edit/delete operations) | Medium |
| API abuse | Agent management requires direct server access | Medium |
| Encryption password leak | Stored in `.env`, excluded from Git via `.gitignore` | Low |

### Defense in Depth

Security is enforced at multiple layers:

1. **Infrastructure Layer** — Keys encrypted at rest, secrets in `.env`, files gitignored
2. **Policy Layer** — Trade size limits, daily spending caps, cooldown enforcement
3. **Application Layer** — Audit logging, error isolation, graceful degradation
4. **Network Layer** — All Solana communication via HTTPS RPC
5. **Operational Layer** — Secure key deletion on agent removal

### What Would Change for Production

1. **HSM/TEE Integration** — Use hardware security modules or Trusted Execution Environments for key operations. The signing would happen inside secure enclaves (e.g., AWS Nitro, Intel SGX).
2. **Multi-sig Approval** — High-value trades could require multi-signature approval, combining the agent's key with a human-controlled key.
3. **Rate Limiting** — Add API rate limiting and authentication to prevent unauthorized agent spawning.
4. **Key Rotation** — Periodic key rotation with re-encryption to limit exposure windows.
5. **Encrypted Audit Logs** — Sign log entries with a separate key to provide cryptographic tamper evidence.
6. **Access Control** — Role-based access for API endpoints with JWT authentication.
7. **Mainnet Guards** — Additional confirmation steps, value thresholds, and human-in-the-loop approval for real-value transactions.

---

## 3. AI Agent Integration

### How AI Agents Interact with Wallets

The AI agent does not directly access keys. The architecture enforces a clean separation:

```mermaid
flowchart LR
    AI["AI Engine"] -->|"TradeDecision"| PG["PolicyGuard"]
    PG -->|"Validated Decision"| TE["Trading Engine"]
    TE -->|"Signs Transaction"| WM["WalletManager"]
    WM -->|"Decrypts Key"| KV["KeyVault"]
    KV -->|"Keypair"| WM
    WM -->|"Signed TX"| SOL["Solana RPC"]
```

The AI engine never sees the secret key. It produces a `TradeDecision` (action, amount, tokens, reasoning), which flows through policy validation before the trading engine requests a signature from the wallet manager. This is analogous to a trader telling a custodian what to do — the trader never handles the vault keys.

### Decision Engine Architecture

```mermaid
flowchart TD
    MD["Market Data"] --> AI
    PS["Portfolio State"] --> AI
    subgraph AI["AI Decision Engine"]
        GEM["Gemini 2.5 Flash-Lite"]
        RE["Rule Engine (fallback)"]
    end
    RP["Risk Profile"] --> PG
    AI --> PG["Policy Guard (validate)"]
    PG --> TE["Trading Engine (execute)"]
    TE --> SOL["Solana Devnet (confirm)"]
```

### How LLM Decisions Work

The AI engine sends a structured prompt to Google Gemini containing:

- **Market data**: Current prices, 24h changes, volumes, and overall trend (bullish/bearish/sideways)
- **Portfolio state**: SOL balance, token holdings, and total estimated USD value
- **Risk profile**: Max trade size, daily limit, stop-loss/take-profit percentages, and preferred tokens
- **Clear instructions**: Respond with structured JSON containing the decision

The LLM returns a decision with:
- **Action**: `BUY`, `SELL`, or `HOLD`
- **Token pair**: Which tokens to swap (e.g., SOL → USDC)
- **Amount**: How much to trade (in SOL), respecting the risk profile
- **Confidence**: 0.0 to 1.0 confidence score
- **Reasoning**: Natural language explanation of why this decision was made

### Automatic Fallback System

The platform handles LLM unavailability gracefully:

```mermaid
flowchart TD
    START["Decision Needed"] --> CHECK{"Gemini Available?"}
    CHECK -->|"API Key Set + Not Rate-Limited"| GEMINI["Call Gemini API"]
    CHECK -->|"No API Key"| RULES["Use Rule Engine"]
    CHECK -->|"Rate Limited"| RULES
    GEMINI -->|"Success"| DECISION["TradeDecision"]
    GEMINI -->|"429 Rate Limit"| DETECT["Detect Rate Limit"]
    DETECT --> BACKOFF["Set Cooldown (60-300s)"]
    BACKOFF --> RULES
    GEMINI -->|"Other Error"| RETRY["Retry with Backoff (up to 2x)"]
    RETRY -->|"Still Failing"| RULES
    RETRY -->|"Success"| DECISION
    RULES --> DECISION
```

When Gemini hits rate limits, the system:
1. Detects the 429 error and extracts the retry delay
2. Marks the AI engine as rate-limited for the specified cooldown period
3. Seamlessly falls back to the Rule Engine for immediate decisions
4. Automatically retries Gemini when the cooldown expires

The Rule Engine uses:
- **Short/Long moving average crossover** for trend detection (5-period vs 20-period)
- **Momentum indicators** for signal strength
- **Risk-adjusted position sizing** based on the agent's profile
- **All decisions are prefixed with `[RuleEngine fallback]`** so operators can distinguish AI from rule-based decisions

---

## 4. Separation of Concerns

```mermaid
block-beta
    columns 1
    block:P["Presentation: Dashboard (HTML/CSS/JS) + WebSocket"]
    end
    block:A["Application: Agent Manager + REST API + WS Handler"]
    end
    block:D["Domain Logic: Agent + AI Engine + Trading Engine"]
    end
    block:S["Security: KeyVault + PolicyGuard + AuditLogger"]
    end
    block:I["Infrastructure: WalletManager + JupiterClient + Solana RPC"]
    end
```

Each layer has a clear, single responsibility:

| Layer | Module | Responsibility |
|-------|--------|---------------|
| **Presentation** | Dashboard, WebSocket | Display real-time agent activity |
| **Application** | AgentManager, API, WSHandler | Orchestrate agent lifecycle and external communication |
| **Domain** | Agent, AIEngine, TradingEngine | Business logic: decisions and trade execution |
| **Security** | KeyVault, PolicyGuard, AuditLogger | Encryption, validation, and compliance |
| **Infrastructure** | WalletManager, JupiterClient | Blockchain interaction and swap routing |

This separation ensures that:
- The AI module knows nothing about encryption or transaction signing
- The wallet module knows nothing about trading strategy
- The policy module can be independently audited
- Each module can be tested, replaced, or upgraded independently

---

## 5. Trading on Solana Devnet

### How Trades Are Executed

On devnet, Jupiter Aggregator API is primarily mainnet-focused, so Bridle uses a simulation approach:

1. **Quote**: The JupiterClient generates a simulated swap quote with realistic pricing, slippage, and routing
2. **Validation**: The PolicyGuard checks the trade against the agent's limits
3. **Execution**: A real on-chain transaction (self-transfer) is signed and submitted as proof of execution
4. **Confirmation**: The transaction is confirmed on Solana devnet and the signature is logged

This approach provides:
- **Real on-chain transactions** — Every trade produces a verifiable signature on Solana Explorer
- **Realistic behavior** — Simulated quotes include slippage and price impact
- **Easy upgrade path** — Switching to real Jupiter swaps requires only changing `useSimulation: false`

### Transaction Signing Flow

```mermaid
sequenceDiagram
    participant A as Agent
    participant TE as TradingEngine
    participant PG as PolicyGuard
    participant JC as JupiterClient
    participant WM as WalletManager
    participant KV as KeyVault
    participant SOL as Solana

    A->>TE: executeTrade(decision)
    TE->>PG: validateTrade(agentId, decision)
    PG-->>TE: { allowed: true }
    TE->>JC: getQuote(inputMint, outputMint, amount)
    JC-->>TE: SwapQuote
    TE->>WM: getAgentKeypair(agentId)
    WM->>KV: retrieveKey(agentId)
    KV-->>WM: decrypted secretKey
    WM-->>TE: Keypair
    TE->>SOL: sendAndConfirmTransaction(signedTx)
    SOL-->>TE: signature
    TE-->>A: TradeResult
```

---

## 6. Scalability

### Multi-Agent Architecture

The `AgentManager` treats each agent as an independent unit:
- Each agent has its own wallet, decision engine, and trading loop
- Agents share the RPC connection but have fully isolated state
- The event system (pub/sub) decouples agents from the dashboard
- Adding a new agent is a single API call with zero downtime

### Scaling Strategies

| Dimension | Current | Production Path |
|-----------|---------|-----------------|
| Agents per instance | ~10 | Horizontal scaling with message queues |
| Decision latency | ~1-3s (Gemini 2.5-flash-lite) | Batch prompts, model caching |
| RPC calls | Shared connection | Connection pool, dedicated RPC nodes |
| Key storage | File-based | Database or HSM-backed vault |
| Audit logs | Local JSONL files | Centralized logging (ELK, Datadog) |
| Dashboard | Single WebSocket | Load-balanced WebSocket with Redis pub/sub |

---

## 7. Devnet vs Mainnet

This prototype runs exclusively on Solana Devnet. Key differences for a production mainnet deployment:

| Aspect | Devnet (Current) | Mainnet (Future) |
|--------|-------------------|-------------------|
| SOL | Free via faucet airdrop | Real monetary value |
| Trades | Simulated Jupiter quotes | Live Jupiter Aggregator v6 |
| Security | Encrypted file storage | HSM + multi-sig + TEE |
| Policies | Soft limits (learning mode) | Hard limits + human override |
| Monitoring | Dashboard only | Alerting + anomaly detection + PagerDuty |
| Key Management | File-based | Vault (HashiCorp) or AWS KMS |
| Authentication | None (local dev) | JWT + OAuth2 + API keys |

---

## 8. Technologies Used

| Component | Technology | Why |
|-----------|------------|-----|
| Language | TypeScript 5.7 | Type safety critical for financial logic |
| Runtime | Node.js 20+ | Async I/O for concurrent agent loops |
| Blockchain | @solana/web3.js | Direct Solana RPC interaction, transaction signing |
| AI | Google Gemini 2.5-flash-lite | High free-tier limits (1000 req/day), fast inference |
| Encryption | Node.js crypto | AES-256-GCM with PBKDF2 — battle-tested, zero dependencies |
| Server | Express + ws | Lightweight HTTP + WebSocket on same port |
| Dashboard | Vanilla HTML/CSS/JS | Zero build step, zero dependencies, instant load |
| Icons | Bootstrap Icons | Clean, consistent iconography via CDN |
| Fonts | Bricolage Grotesque + Outfit | Modern typography for professional UI |

---

## 9. What Makes Bridle Different

Most agentic wallet demos show a single agent executing a hardcoded task. Bridle goes further:

1. **Multi-agent** — N agents running simultaneously, each with independent wallets and strategies
2. **Real AI reasoning** — Not just keyword matching; Gemini analyzes market data holistically
3. **Graceful degradation** — Automatic fallback from LLM to rule engine on rate limits
4. **Security-first** — Encrypted key storage, policy guards, and audit trails are core features, not afterthoughts
5. **Observable** — Real-time dashboard shows every decision, trade, and balance change as it happens
6. **Extensible** — Adding new strategies, tokens, or risk profiles requires minimal code changes

---

Built by [thetruesammyjay](https://github.com/thetruesammyjay) for the Superteam Nigeria DeFi Developer Challenge.

# AI Sentinel — Enterprise AI Red Teaming & Governance Platform

> **Autonomous, continuous adversarial security evaluation and governance infrastructure for enterprise AI agent fleets.**

---

## 1. What This Platform Does

**AI Sentinel** is a production-grade AI security and governance platform designed to continuously test, evaluate, and audit AI agents (LLM chatbots, RAG pipelines, autonomous agents, and tool-augmented assistants) against adversarial exploits and compliance violations.

Rather than relying on static test sets or manual penetration testing, the platform orchestrates autonomous, context-aware red teaming campaigns. It dynamically crafts adversarial payloads tailored to an agent's specific domain, executes multi-vector attacks across both behavioral and policy layers, streams execution telemetry in real time, and produces audit-ready compliance mappings against major international standards.

### Key Capabilities

- **Fleet-Wide Agent Registry:** Catalogs AI agent endpoints with granular metadata, including operational domain, sensitive data exposure levels, multi-agent tool schemas (MCP), architecture topology diagrams, and deployment jurisdictions.
- **Dynamic Context-Aware Attack Planning:** Synthesizes agent metadata, sample conversational pairs, and system prompt constraints using an LLM Orchestrator to generate targeted adversarial attack plans instead of generic brute-force prompts.
- **Dual-Engine Adversarial Pipeline:** Combines behavioral penetration probes (**DeepTeam**) with application security policy sweeps (**Promptfoo**) to cover single-turn and multi-turn attack vectors.
- **LLM-as-a-Judge Response Evaluation:** Evaluates target agent responses using deterministic judges (Groq multi-model pools and local Ollama evaluators) to verify jailbreak success, data leakage, refusal bypass, and policy compliance.
- **Real-Time Pipeline Telemetry:** Delivers live stage-by-stage execution events, pass/fail metrics, and attack transcripts to operators via persistent Server-Sent Events (SSE).
- **Enterprise Regulatory Compliance Mapping:** Automatically translates red team attack results into compliance postures for the **EU AI Act**, **NIST AI RMF**, **OWASP Top 10 for LLMs**, **GDPR**, **HIPAA**, **India DPDPA**, and **RBI AI Guidelines**.
- **Automated Recurring Governance Schedules:** Operates continuous audit loops via cron schedules, ensuring model drift, prompt updates, or backend changes do not introduce security regressions.
- **Fleet-Wide Batch Attack Operations:** Coordinates concurrent red teaming sweeps across entire fleets with concurrency throttling to prevent target denial-of-service.
- **Threat Notification & Alert Engine:** Automatically detects vulnerability spikes, severity threshold breaches, and score drops, dispatching actionable alerts to operators.
- **Audit Transcripts & Historical Comparison:** Preserves immutable attack-and-response transcripts, enabling regression tracking and differential session comparisons across model versions.

---

## 2. Runtime System Architecture

The application runs as a distributed system comprising a presentation layer, an API gateway, a durable workflow engine, dual adversarial attack runners, an LLM evaluation tier, and a persistent state store.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PRESENTATION TIER                               │
│              React 19 / TanStack Start / Tailwind CSS                  │
│                                                                        │
│   ┌───────────────────┐  ┌───────────────────┐  ┌──────────────────┐   │
│   │ Fleet Dashboard   │  │ Live SSE Stream   │  │ Analytics &      │   │
│   │ & Agent Registry  │  │ Evaluation Viewer │  │ Transcripts      │   │
│   └─────────┬─────────┘  └─────────▲─────────┘  └────────▲─────────┘   │
└─────────────┼──────────────────────┼─────────────────────┼─────────────┘
              │ REST Requests        │ Server-Sent Events  │ Query Data
              ▼                      │                     │
┌────────────────────────────────────┴─────────────────────┴─────────────┐
│                          API GATEWAY TIER                              │
│                      FastAPI Application Engine                        │
│                                                                        │
│  • Agent Management & Config    • Batch Fleet Trigger                  │
│  • Session State Queries        • Threat Notifications Service         │
│  • SSE Progress Distributor     • CSV/JSON Transcript Exporter         │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Dispatches Workflows
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     WORKFLOW ORCHESTRATION TIER                        │
│                           Temporal Server                              │
│                                                                        │
│   ┌──────────────────────────┐      ┌──────────────────────────────┐   │
│   │   RedTeamWorkflow        │      │   BatchRedTeamWorkflow       │   │
│   │   (Per-Agent Pipeline)   │      │   (Fleet Throttled Executor) │   │
│   └─────────────┬────────────┘      └──────────────┬───────────────┘   │
│                 │                                  │ (Up to 3 concurrent)
│                 └─────────────────┬────────────────┘                   │
│                                   ▼                                    │
│                 ┌──────────────────────────────────┐                   │
│                 │     Temporal Worker Daemon       │                   │
│                 └─────────────────┬────────────────┘                   │
└───────────────────────────────────┼────────────────────────────────────┘
                                    │ Executes Deterministic Activities
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   EXECUTION & EVALUATION TIER                          │
│                                                                        │
│  [Activity 1] Attack Orchestrator (Groq Multi-Key Pool)                │
│       │ Generates tailored attack matrix                               │
│       ▼                                                                │
│  [Activity 2] DeepTeam Adversarial Probe Runner                        │
│       │ Multi-turn probes, jailbreaks, PII harvesting                  │
│       ▼                                                                │
│  [Activity 3] Promptfoo Policy Scanner                                 │
│       │ AppSec sweeps, hallucination, bias, system overrides           │
│       ▼                                                                │
│  [Activity 4] Results Aggregator & Compliance Mapper                   │
│       │ PLOT4ai scoring, regulatory matrix, threat notifications       │
└──────────────┬──────────────────────────────────────────┬──────────────┘
               │                                          │
               ▼ Target Calls                             ▼ State & Transcripts
┌──────────────────────────────┐          ┌──────────────────────────────┐
│     TARGET AI AGENT(S)       │          │     SUPABASE POSTGRESQL      │
│   External HTTP Endpoints    │          │   Persistent Storage Layer   │
└──────────────────────────────┘          └──────────────────────────────┘
```

---

## 3. How the Application Operates (End-to-End Execution Flow)

```
[Agent Registration]
        │
        ▼
[Trigger Evaluation (Manual / Scheduled / Batch)]
        │
        ▼
[Temporal Workflow Initialized] ──► Sets Session Status: "running"
        │
        ├─► [Stage 1: LLM Attack Planning]
        │         Groq evaluates agent domain, tools & sensitivity
        │         Yields targeted vulnerability matrix & test counts
        │
        ├─► [Stage 2: DeepTeam Adversarial Execution]
        │         Executes dynamic adversarial probes against target HTTP API
        │         Validates target responses via LLM Judges
        │         Emits real-time progress events to DB & SSE stream
        │
        ├─► [Stage 3: Promptfoo Application Security Sweep]
        │         Executes policy vulnerability assertions
        │         Validates system prompt extraction & unauthorized tool execution
        │         Emits real-time progress events to DB & SSE stream
        │
        └─► [Stage 4: Aggregation & Risk Assessment]
                  Calculates composite Confidence Score (0–100%)
                  Categorizes threats into PLOT4ai & STRIDE taxonomies
                  Maps findings to EU AI Act, NIST AI RMF, OWASP Top 10, GDPR
                  Generates operator notifications for threshold violations
                  Marks Session Status: "complete"
```

### Stage 1: Dynamic Attack Planning (LLM Orchestration)
When an evaluation starts, the pipeline avoids static wordlists. Instead, it inspects:
- Agent domain (Financial, Healthcare, E-Commerce, Legal, etc.)
- Data sensitivity tier (Public, Confidential, Highly Sensitive, PII)
- Registered tool manifests (MCP / API tools available to the agent)
- Operational geography and regulatory jurisdiction

The **LLM Orchestration Service** feeds this metadata to a dedicated planning model (`llama-3.3-70b-versatile` via Groq) to assemble a tailored test matrix specifying which vulnerability classes to target, which attack strategies to apply, and how many test cases to execute.

### Stage 2: DeepTeam Adversarial Probing
The worker invokes the **DeepTeam Engine** to generate and fire targeted adversarial inputs against the target agent's live HTTP endpoint:
- **Jailbreaking & Evasions:** Prefix injection, token manipulation, hypothetical roleplay framing, and linguistic obfuscation.
- **Sensitive Data & PII Harvesting:** Multi-step interrogation patterns designed to trick the agent into exfiltrating training data or system prompt instructions.
- **Harmful Behavior Probes:** Direct elicitation of restricted topics, dangerous procedures, or discriminatory outputs.
- **LLM-as-a-Judge Evaluation:** Each target agent response is inspected by an independent evaluator judge (local Ollama instance or fallback Groq pool) to determine if the target safely refused the prompt or succumbed to the exploit.

### Stage 3: Promptfoo Security Policy Sweeping
The worker executes a **Promptfoo Security Sweep** to run structured assertions against the agent:
- **Prompt Injection & Hijacking:** Testing if user input can override system instructions.
- **Excessive Agency & Unauthorized Action:** Checking if the agent agrees to perform actions outside its authorized tool schema.
- **Overreliance & Hallucination:** Evaluating factual stability under misleading adversarial premises.
- Each probe records input payloads, raw target responses, latency, and assertion pass/fail flags directly into the session database.

### Stage 4: Scoring, Compliance Mapping & Threat Dispatch
The **Results Aggregator** compiles the findings from both engines:
1. **Confidence Score Calculation:** Derives a weighted composite score (0–100%) reflecting overall agent robustness.
2. **Risk Tier Assignment:** Categorizes the agent into `Critical`, `High`, `Medium`, or `Low` risk.
3. **Taxonomy Alignment:** Categorizes vulnerabilities according to **PLOT4ai** (Privacy, Lawfulness, Oversight, Transparency) and **STRIDE** models.
4. **Regulatory Posture Generation:** Maps failed tests to relevant articles in the **EU AI Act**, subcategories in the **NIST AI RMF**, and items in the **OWASP LLM Top 10**.
5. **Notification Trigger:** If the evaluation reveals critical flaws or drops below governance thresholds, the system dispatches high-priority notification records to the operator inbox.

---

## 4. Subsystem Breakdown

### 1. Fleet Registry & Threat Modeling Engine
- Manages agent registrations with target URLs, authentication headers, description, domain, and deployment geography.
- Accepts and parses **OWASP Threat Dragon** threat models, extracting STRIDE threat components to focus testing on predefined architectural risks.
- Maintains versioned Golden Datasets of expected user-agent interaction pairs for regression benchmarking.

### 2. Temporal Orchestration & Reliability Layer
- Runs `RedTeamWorkflow` and `BatchRedTeamWorkflow` on a dedicated task queue (`redteam-task-queue`).
- Employs deterministic workflow definitions with activity heartbeating (30s) and exponential backoff retry policies (up to 2 attempts with 10-minute timeouts per stage).
- Enforces workflow termination signals, allowing operators to immediately halt running campaigns and cleanup background executor threads.
- Manages cron-based `Temporal Schedules` per registered agent (`ScheduleOverlapPolicy.SKIP` prevents overlapping runs when a prior evaluation is still active).

### 3. Real-Time Telemetry & SSE Distribution
- As activities progress, the system writes progress increments (0–100%), stage status flags, and log messages to a dedicated tracking table (`redteam_progress`).
- The backend SSE service (`/api/v1/redteam/stream`) streams structured events (`stage_start`, `stage_update`, `stage_complete`, `evaluation_complete`, `evaluation_error`, `terminated`) to the client over an HTTP `EventSource` connection.
- Decouples long-running asynchronous test execution from the client UI, allowing operators to monitor live test execution without holding open blocking HTTP requests.

### 4. Batch Fleet Execution Engine
- Enables one-click evaluation of all registered agents across the entire enterprise inventory.
- Spawns a parent `BatchRedTeamWorkflow` that controls individual child workflows.
- Uses an asynchronous semaphore (maximum 3 concurrent workflows) to avoid saturating network resources or exceeding downstream LLM provider rate limits.

---

## 5. Threat Vectors Evaluated

The pipeline tests agent endpoints across behavioral, prompt-level, and application-level attack surfaces:

| Attack Vector | Category | Description |
|:---|:---|:---|
| **Prompt Injection** | Behavioral | Subverting system instructions using indirect or direct adversarial framing |
| **System Prompt Extraction** | Behavioral | Coaxing the model into revealing internal prompts, secrets, or operational rules |
| **Jailbreak (Roleplay / Obfuscation)** | Behavioral | Bypassing safety alignment via persona adoption, hypothetical scenarios, or encoding |
| **PII & Data Leakage** | Privacy | Probing for unauthorized disclosures of sensitive personal or corporate data |
| **Excessive Agency / Tool Misuse** | Agentic / MCP | Testing if the agent will trigger unauthorized tools, APIs, or parameters |
| **Toxicity & Hate Speech** | Safety | Evaluating model resistance to generating abusive, discriminatory, or harassing content |
| **Misinformation & Hallucination** | Integrity | Testing susceptibility to adopting and amplifying false factual premises |
| **Overreliance & Bias** | Safety | Measuring uncritical agreement with biased, harmful, or legally risky assumptions |

---

## 6. Standards & Compliance Framework Coverage

Evaluation results are systematically cross-referenced against global regulatory and security frameworks:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        COMPLIANCE MAPPINGS                             │
├───────────────────┬────────────────────────────────────────────────────┤
│ EU AI Act         │ High-risk system obligations (Transparency,        │
│                   │ Accuracy, Cybersecurity, Risk Management System)   │
├───────────────────┼────────────────────────────────────────────────────┤
│ NIST AI RMF       │ MAP, MEASURE, MANAGE functions; Trustworthy AI     │
│                   │ characteristics (Security, Resilience, Validity)   │
├───────────────────┼────────────────────────────────────────────────────┤
│ OWASP LLM Top 10  │ LLM01 (Prompt Injection), LLM02 (Data Leakage),    │
│                   │ LLM06 (Excessive Agency), LLM07 (System Overrides) │
├───────────────────┼────────────────────────────────────────────────────┤
│ GDPR & DPDPA      │ Data minimization, unauthorized disclosure,        │
│                   │ privacy risk mitigation                            │
├───────────────────┼────────────────────────────────────────────────────┤
│ PLOT4ai & STRIDE  │ Privacy, Lawfulness, Oversight, Transparency,      │
│                   │ Spoofing, Tampering, Repudiation, Information Leak │
└───────────────────┴────────────────────────────────────────────────────┘
```

---

## 7. Data Architecture & Persistence

All operational and analytical records are stored in PostgreSQL:

| Entity | Role in System |
|:---|:---|
| `users` | Operator identities, access credentials, and profile records |
| `registered_agents` | Agent endpoints, metadata, deployment countries, sensitivity, schedule config |
| `redteam_agents` | Detailed agent specs, sample conversational pairs, MCP tool definitions, diagrams |
| `redteam_sessions` | Evaluation run records: lifecycle status, composite score, risk tier, run metadata |
| `attack_plans` | Synthesized attack plans: targeted vulnerabilities, attack types, test allocations |
| `attack_transcripts` | Granular log of every attack probe: input payload, target response, score, verdict |
| `redteam_progress` | Transient stage progression and status messages for real-time SSE delivery |
| `redteam_threat_models` | Parsed Threat Dragon diagrams and associated STRIDE threats |
| `notifications` | Threat alerts generated for low-scoring sessions or severe vulnerability detections |

---

## 8. Resilience & Security Design

- **Multi-Key LLM Provider Rotation:** Maintains a pool of API keys for LLM orchestration and evaluation; automatically rotates keys when rate-limiting thresholds (HTTP 429) are encountered.
- **Dual Judge Redundancy:** Employs cloud LLM judges with seamless fallback to local Ollama inference instances for deterministic scoring without external data transit.
- **Workflow State Recovery:** Temporal's event sourcing guarantees that in the event of an infrastructure crash or worker restart, evaluation progress resumes from the last completed activity without data corruption.
- **Non-Destructive Target Probing:** Executes controlled adversarial probes via standard HTTP calls without injecting persistent state or corrupting downstream target databases.

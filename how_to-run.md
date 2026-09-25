# AI Sentinel Platform — Execution & Operations Guide (`how_to-run.md`)

This guide provides step-by-step instructions for running, configuring, and verifying the **AI Sentinel Platform**,  **Red Teaming Pipeline** (DeepTeam & Promptfoo), and **Governance & Compliance Analytics** into a single production-grade dashboard.

---

## 1. System Architecture & Port Mapping

| Component | Technology | Directory | Default Port / URL |
| :--- | :--- | :--- | :--- |
| **Unified Backend** | FastAPI, SQLAlchemy, Temporal Worker | `backend` | `http://localhost:8050` |
| **API Docs (Swagger)** | OpenAPI 3.0 | `backend` | `http://localhost:8050/docs` |
| **Unified Frontend** | Vite, React 19, TanStack Router/Query | `frontend` | `http://localhost:8080` |
| **Temporal Server** | Temporal Workflow Engine | Host machine / Docker | `localhost:7233` (automatic fallback in-process if offline) |


---

## 2. Prerequisites & System Dependencies

1. **Python 3.11+**
   ```bash
   python3 --version
   ```
2. **Node.js (v18+) and npm**
   ```bash
   node -v
   npm -v
   ```
4. **Promptfoo CLI**
   - Pre-installed or run via npx:
   ```bash
   npx promptfoo@latest --version
   ```
5. **(Optional) Local Ollama**
   - For local LLM evaluation without rate limits:
   ```bash
   ollama pull qwen2.5:3b-instruct
   ```

---

## 3. Environment Configuration

### Backend Environment (`unified_platform/backend/.env`)

1. Copy the example file if setting up for the first time:
   ```bash
   cd /home/bitla/truviq_agentregistry_demo/AI-goverance/unified_platform/backend
   cp .env.example .env
   ```

2. Verify that your `.env` contains the required keys:
   ```env
   # ---- Database (Supabase PostgreSQL Connection String) ----
   DATABASE_URL=postgresql://postgres.<project_id>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres

   # ---- Supabase REST API & Service Credentials ----
   SUPABASE_URL=https://<project_id>.supabase.co
   SUPABASE_SERVICE_KEY=<your_supabase_service_role_jwt_key>

   # ---- JWT Authentication Secret ----
   JWT_SECRET_KEY=truviq_redteam_super_secret_jwt_key_production

   # ---- Groq (LLM Orchestrator & Evaluation Provider) ----
   GROQ_API_KEY=gsk_your_groq_api_key_here
   GROQ_ENDPOINT=https://api.groq.com/openai/v1
   GROQ_MODEL=llama-3.3-70b-versatile

   # ---- Local Ollama (Optional) ----
   OLLAMA_BASE_URL=http://localhost:11434/v1
   OLLAMA_MODEL=qwen2.5:3b-instruct

   # ---- Temporal Server ----
   TEMPORAL_HOST=localhost:7233

   # ---- Registry CLI ----
   ARCTL=/usr/local/bin/arctl
   DAEMON_URL=http://localhost:12121
   ```

### Frontend Environment (`unified_platform/frontend/.env`)

1. Verify or create `unified_platform/frontend/.env`:
   ```env
   VITE_API_BASE_URL=http://localhost:8050
   ```

---

## 4. Running the Platform

### Terminal 1: Start the Backend Service

1. Navigate to the backend directory:
   ```bash
   cd /home/bitla/truviq_agentregistry_demo/AI-goverance/unified_platform/backend
   ```

2. (Optional) Activate your Python virtual environment if using one:
   ```bash
   source venv/bin/activate
   ```

3. Install requirements (first time only):
   ```bash
   pip install -r requirements.txt
   ```

4. Launch the FastAPI server:
   ```bash
   python3 main.py
   ```
   *Alternatively with uvicorn directly:*
   ```bash
   uvicorn main:app --host 0.0.0.0 --port 8050
   ```

5. Confirm startup logs:
   ```text
   [Supabase] Client initialized.
   [Temporal Worker] Worker connected & listening on queue 'redteam-task-queue'!
   INFO:     Uvicorn running on http://0.0.0.0:8050 (Press CTRL+C to quit)
   ```

6. Verify backend health:
   ```bash
   curl -s http://localhost:8050/health
   # Expected output: {"status":"ok","service":"Unified Agent Registry & Red Teaming Platform", ...}
   ```

---

### Terminal 2: Start the Frontend Application

1. Navigate to the frontend directory:
   ```bash
   cd /home/bitla/truviq_agentregistry_demo/AI-goverance/unified_platform/frontend
   ```

2. Install dependencies (first time only):
   ```bash
   npm install
   ```

3. Start the Vite development server:
   ```bash
   npm run dev -- --port 8080 --host 0.0.0.0
   ```

4. Confirm startup logs:
   ```text
     VITE v8.3.0  ready in 1400 ms

     ➜  Local:   http://localhost:8080/
     ➜  Network: http://<ip>:8080/
   ```

5. Open your browser and navigate to:
   **[http://localhost:8080](http://localhost:8080)**

---

## 5. Navigating the Unified Dashboard

Once loaded, use the top navigation bar to access the unified workflows:

```
[Overview]  |  [Register]  |  [Pipeline]  |  [Fleet]  |  [Results]  |  [Catalog]
```

### 1. **Overview Dashboard (`/`)**
- High-level system overview showing total registered agents, active deployments, security health status, and live evaluation stats.

### 2. **Fleet Dashboard (`/fleet`)**
- Centralized fleet view of all registered agents:
  - Shows agent status (`Active` / `Paused`), last evaluated timestamp, schedule interval, and latest composite confidence score.
  - **"Re-run"**: Triggers an on-demand re-evaluation of that agent.
  - **"Results" button**: Directly navigates to the complete results breakdown for that agent's latest run.
  - **Session History Dropdown**: Expand any agent card to see historical sessions with timestamps and individual **"Results"** links.

### 4. **Red Teaming Results Page (`/results` or `/results?session=<id>`)**
- Comprehensive audit report generated for the evaluation session:
  - **Confidence Gauge**: Semi-circular visual gauge showing overall score (0–100%) and tier (*Trusted / Production Ready*, *Moderate Risk*, *Critical Risk*).
  - **Attack Outcome Split**: Pie chart of passed vs. failed attacks, plus framework probe breakdown (**DeepTeam** dynamic adversarial probes vs. **Promptfoo** AppSec policy checks).
  - **Stat Cards**: Total Attacks, Passed Probes, Failed Probes, and Pass Rate %.
  - **Attack Probes Table**: Interactive table with framework badge, vulnerability category, score progress bar, and pass/fail status.
  - **PLOT4AI Threat Radar**: Visual radar chart displaying risk across PLOT4AI threat dimensions.
  - **LLM Performance Metrics**: Quality and safety scores (Faithfulness, Relevancy, Hallucination Rate, Tool Invocation Accuracy, Scope Adherence) tailored to the agent's architecture.
  - **Regulatory Compliance**: Checks against EU AI Act, NIST AI RMF, ISO 42001, and OWASP LLM Top 10.
  - **Jurisdictional Verdicts**: Pass/flag status for target deployment countries (US, EU, UK, India, Singapore).
  - **Individual Attack Transcripts**: Searchable transcript explorer revealing the exact prompt payloads, agent responses, evaluator reasoning, and copy button.
  - **JSON Export**: Download complete results as a machine-readable `.json` artifact.

### 5. **Catalog (`/catalog`)**
- Browse all packaged agents, MCP servers, skills, and prompts published into the local registry.

---

## 6. Verifying Production Build

To verify that the frontend compiles cleanly for production:

```bash
cd /home/bitla/truviq_agentregistry_demo/AI-goverance/unified_platform/frontend
npm run build
```

Expected output:
```text
✓ built in ~2.9s
[nitro] ✔ Generated .output/public
```

---

## 7. Troubleshooting & FAQ

### Backend: `ModuleNotFoundError: No module named 'deepteam'`
- Ensure you are running Python with the virtualenv/conda environment where requirements are installed:
  ```bash
  pip install -r requirements.txt
  ```

### Backend: Temporal Server Offline
- The unified backend includes an **automatic in-process fallback engine**. If Temporal server (`localhost:7233`) is not reachable, the system logs a fallback notice and executes attack probes asynchronously in the background.

### Frontend: Port 8080 already in use
- Run on an alternate port:
  ```bash
  npm run dev -- --port 3000 --host 0.0.0.0
  ```
  *(Remember to update CORS settings if changing the default frontend port)*.

### Database Connection Issues
- Ensure your `DATABASE_URL` in `backend/.env` is accessible. The system automatically handles connection pooling and reconnects on demand.

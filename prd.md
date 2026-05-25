# Codex Swarm Monitor PRD

## Current Implementation Update

The production direction has superseded the original mockup notes below:

- End users should be able to use the monitor with Codex installed and a standalone `codex-swarm-monitor` release bundle; Node/npm are bundled for the app runtime.
- The UI must not load demo, seed, or mock events. Empty state is valid until real Codex hooks or MCP events arrive.
- Agent portraits are now generated as local Notion-style SVGs through `/avatar`; the app no longer depends on DiceBear or any remote avatar CDN.
- The main surface follows a white GitHub Repository / Notion / Goodnotes style: dense repo navigation, quiet side panels, and a paper-like harness canvas.

Source: conversation brief captured on 2026-05-24.

2026-05-25 product update: the app should no longer depend on sample traffic. The primary product flow is local folder selection, Codex-native hook installation, workspace/Ralph harness analysis, and live event visualization for real Codex workspaces.

2026-05-25 distribution update: the target user should only need Codex in the observed workspace. The primary path is a Codex marketplace plugin that bootstraps the standalone runtime and starts `codex-swarm-monitor --workspace "$PWD" --connect --open`; npm/npx is retained for package verification and developer fallback only. The runtime supports `--workspace <path>`, installs self-contained native Codex hooks into `.codex/codex-swarm-monitor/`, keeps data local in SQLite, falls back to a free local port when 4000 is busy, and treats OMX/MCP as optional enhancements rather than a required runtime.

2026-05-25 verification update: release gating now includes `npm run verify`, which covers syntax checks, Node tests, packaged tarball smoke, plugin smoke, plugin package smoke, standalone smoke, artifact audit, plugin bootstrap smoke, packaged Codex-only plugin smoke, fresh-machine smoke, runtime CLI/API/UI smoke, and optional MCP dry-run. CI runs the same gate on Node 24.

2026-05-25 preflight update: the app now exposes `codex-swarm-monitor --doctor` and `GET /doctor?path=...` for fresh-machine readiness checks. The UI Preflight panel surfaces Node, Codex, `codex doctor`, workspace permission, and hook installation status without seed/mock data.

2026-05-25 plugin update: the repository is also a Codex plugin source via `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`, and `skills/codex-swarm-monitor/SKILL.md`. This gives Codex-only users a native discovery/operation path while npm and future standalone binaries remain the direct runtime distribution paths.

2026-05-25 standalone update: `npm run standalone:build` creates `dist/codex-swarm-monitor-<platform>-<arch>` and a tarball containing the app plus a bundled Node runtime. `npm run standalone:smoke` verifies that the bundled launcher starts the server, connects a workspace, and installs self-contained hooks without relying on a user-installed Node/npm runtime.

2026-05-25 Codex-only packaging update: `npm run codex-only:smoke` extracts the published plugin package shape, verifies it contains no development `apps/backend` source tree or `package.json`, then starts through the packaged plugin script using only release artifacts. This specifically guards the "users only need Codex" path.

2026-05-25 release update: `.github/workflows/release.yml` builds standalone artifacts on Linux x64, macOS arm64, macOS x64, and Windows x64 runners, smoke-tests each artifact, uploads workflow artifacts, and publishes them to GitHub Releases when a `v*` tag is pushed.

훌륭한 프로젝트입니다 — 이게 실제 빌드되면 OMX 생태계에 *없는* 결정적 도구가 돼요. 정리해서 셋업 + 아키텍처 + 첫 명령까지 드리고, **목업 UI를 먼저 만들어서 비전이 정확히 일치하는지 확인**해보시죠.

먼저 솔직히 짚을 한 가지 — 알렉스님이 잡은 그림은 *3개 도전 과제가 겹친 작품*입니다:

1. **관찰성**: Codex 내부를 들여다보기 (Arize급)
2. **자동 서브에이전트**: /goal에 없는 Task 도구 시뮬레이션
3. **시각화 UI**: 캐릭터로 표현된 실시간 대시보드

각각 해결 가능하지만 *한 번에 다 풀면 24시간 안 됨*. MVP 범위를 좁히는 게 우승 전략. 셋업하면서 정확히 어디까지가 현실적인지 말씀드릴게요.

먼저 목업으로 비전 검증부터:목업 만들었습니다. **이게 알렉스님이 그리는 UI 맞는지 먼저 확인해주세요.** 6명의 그리스 신화 페르소나 에이전트(Sisyphus·Athena·Hermes·Hephaestus·Argus·Themis)가 로컬 Notion 스타일 SVG 아바타로 각자 다른 얼굴, 각자 다른 상태·작업·읽고 있는 파일을 보여줍니다. 우측 사이드바엔 활성 MD 파일과 라이브 이벤트 로그. 상단에 goal·token·cost·iter 미터.

[original local mockup path removed before public release]

비전이 맞다면, 이제 *어떻게 실제로 만들지*입니다.

---

# Part 1 · 아키텍처 전체 그림

```
┌────────────────────────────────────────────────────────────────┐
│  ALEX's BROWSER (Swarm UI)                                      │
│  React + local SVG avatars + react-flow + SSE EventSource       │
└────────────────────────────────────────────────────────────────┘
                            ↑ SSE (real-time push)
┌────────────────────────────────────────────────────────────────┐
│  EVENT BUS BACKEND                                              │
│  Bun + Hono + SQLite                                            │
│  - POST /events  (수신)                                          │
│  - GET  /stream  (SSE push)                                      │
│  - GET  /state   (현재 스냅샷)                                    │
└────────────────────────────────────────────────────────────────┘
                            ↑ HTTP POST
                ┌───────────┼───────────┐
                │           │           │
┌───────────────┴───┐  ┌────┴─────┐  ┌─┴──────────────┐
│ OMX HOOKS         │  │ MCP      │  │ LiteLLM PROXY  │
│ .omx/hooks/*.mjs  │  │ agent-   │  │ (선택)         │
│ - on_file_read    │  │ spawner  │  │ - 토큰 추적    │
│ - on_tool_use     │  │ - spawn_ │  │ - 모델 호출    │
│ - on_complete     │  │   subag. │  │ - 비용         │
└───────────────────┘  └──────────┘  └────────────────┘
                            ↑
              ┌─────────────┴──────────────┐
              │ CODEX CLI + /goal           │
              │ (메인 + 서브 인스턴스들)     │
              └────────────────────────────┘
```

**4개 레이어**:
1. **Codex CLI** — 실제 일하는 엔진. 여러 인스턴스(메인 + 서브)
2. **Instrumentation Layer** — OMX 훅 + MCP 미들웨어 + (선택)API 프록시. 모든 이벤트 캡처
3. **Event Bus** — 작은 백엔드. 이벤트 받아 저장하고 프론트로 push
4. **Swarm UI** — 알렉스님이 보는 화면

---

# Part 2 · 기술 스택 결정

| 컴포넌트 | 선택 | 이유 |
|:---|:---|:---|
| **OS** | macOS 또는 Linux | OMX 메인 지원 경로 |
| **Codex 래퍼** | OMX (`oh-my-codex`) | 5스킬 + 훅 시스템 이미 빌트인 |
| **백엔드 런타임** | **Bun** | Codex보다 가볍고 빠름, TS 네이티브, SSE 쉬움 |
| **백엔드 프레임워크** | **Hono** | 미니멀, Bun 친화, 5분이면 SSE 셋업 |
| **이벤트 저장소** | **SQLite (better-sqlite3)** | 동기, 로컬, 파일 1개. 랄프톤엔 충분 |
| **프론트엔드** | **React + Vite + Tailwind** | OMX 빌트인 도구로 잘 빌드됨 |
| **에이전트 그래프** | **react-flow** | 노드/엣지 즉시. 직접 SVG보다 빠름 |
| **아바타** | **로컬 Notion-style SVG** | 네트워크 없이 같은 에이전트가 항상 같은 얼굴 |
| **MCP 런타임** | **Python (fastmcp)** | MCP SDK 가장 성숙. Bun에서도 호출 가능 |
| **(선택) LLM 프록시** | **LiteLLM** | OpenAI 호환. 토큰/비용 자동 로깅. Arize 호환 가능 |

로컬 `/avatar` 스타일 데모 — 이름과 역할만 바꾸면 네트워크 없이 다른 얼굴:
```
http://127.0.0.1:4000/avatar?name=Sisyphus&role=Orchestrator
http://127.0.0.1:4000/avatar?name=Hephaestus&role=Builder
...
```

---

# Part 3 · 3-Tier 관찰성 전략 (어디까지 들여다볼 수 있나)

알렉스님이 Arize급 네트워크 introspection을 원하셨는데, Codex는 *오픈 소스가 아니라서* 완전한 introspection은 어렵습니다. 3단계로 절충:

### Tier 1 — OMX 훅 (가장 쉬움, 즉시 가능)
`.omx/hooks/*.mjs`에 lifecycle 콜백 등록. 매 도구 호출, 파일 읽기, 종료 시 자동 발동. 우리 백엔드로 POST 보냄.

```javascript
// .omx/hooks/instrument.mjs
import http from 'node:http';

export async function on_tool_use({ tool, args, agent_id }) {
  await fetch('http://localhost:4000/events', {
    method: 'POST',
    body: JSON.stringify({
      type: 'tool_use', tool, args, agent_id,
      timestamp: Date.now()
    })
  });
}

export async function on_file_read({ path, agent_id }) {
  await fetch('http://localhost:4000/events', {
    method: 'POST',
    body: JSON.stringify({ type: 'file_read', path, agent_id })
  });
}
```

✅ 얻는 것: 파일 읽기, 도구 호출, 완료 이벤트, 어떤 에이전트가 무엇을 하는지

### Tier 2 — MCP 미들웨어 (자동 서브에이전트 발견)
`agent-spawner` MCP 서버를 만들어 Codex에 등록. 모델이 `spawn_subagent(role, task)` 호출하면 MCP가 (a) 서브 codex 띄우고 (b) 이벤트 발행.

```python
# tools/agent-spawner/server.py
from fastmcp import FastMCP
import subprocess, requests, uuid

mcp = FastMCP("agent-spawner")

@mcp.tool()
def spawn_subagent(role: str, task: str, max_tokens: int = 50000):
    """Spawn a specialized subagent with isolated context."""
    agent_id = f"{role}-{uuid.uuid4().hex[:6]}"
    
    requests.post('http://localhost:4000/events', json={
        'type': 'agent_spawn',
        'agent_id': agent_id,
        'role': role,
        'task': task,
        'parent': os.getenv('OMX_AGENT_ID', 'main')
    })
    
    role_prompt = open(f"prompts/subagents/{role}.md").read()
    full_prompt = f"{role_prompt}\n\n## Your Task\n{task}\n\n## ID\nYou are agent {agent_id}."
    
    result = subprocess.run(
        ["codex", "exec", "--yolo", "--max-tokens", str(max_tokens), "-"],
        input=full_prompt, capture_output=True, text=True,
        env={**os.environ, 'OMX_AGENT_ID': agent_id}
    )
    
    requests.post('http://localhost:4000/events', json={
        'type': 'agent_complete',
        'agent_id': agent_id,
        'result_length': len(result.stdout)
    })
    
    return result.stdout
```

✅ 얻는 것: 서브에이전트 spawn 자동화 + 메인-서브 관계 트래킹

### Tier 3 — LiteLLM 프록시 (네트워크 레벨)
가장 강력하지만 가장 복잡. LiteLLM을 OpenAI 호환 프록시로 띄우고, Codex 환경변수를 그쪽으로 향하게 함:

```bash
# litellm 설정으로 모든 API 호출 가로채기
export OPENAI_BASE_URL=http://localhost:8000
litellm --config litellm_config.yaml --port 8000
```

LiteLLM 콜백으로 매 요청·응답을 우리 백엔드로 전송. 토큰·비용·모델·응답 시간 전부 잡힘. **Arize의 OpenInference 호환**.

✅ 얻는 것: 진짜 네트워크 introspection — 어떤 모델이 무슨 프롬프트 받고 어떻게 응답했는지

### 추천 — Tier 1 + 2 (랄프톤 시간 고려)
Tier 3는 데모 강조가 필요할 때만. Tier 1+2로도 알렉스님 비전의 90%는 시연 가능.

---

# Part 4 · OMX 셋업 (Phase 0)

```bash
# 1. 사전 요구
node --version    # ≥20
brew install tmux  # macOS / Linux: sudo apt install tmux

# 2. OMX 설치
npm install -g @openai/codex oh-my-codex

# 3. 인증 + 검증
codex login
omx doctor
omx exec --skip-git-repo-check -C . "Reply with exactly OMX-EXEC-OK"

# 4. 환경변수 (안전장치)
export CODEX_GOAL_MODE=1
export CODEX_MAX_TOKENS=3000000      # 메인 + 서브 고려
export CODEX_MAX_COST=150.00
export CODEX_MAX_ITERATIONS=200

# 5. 프로젝트 디렉터리
mkdir codex-swarm-monitor
cd codex-swarm-monitor
git init
omx setup    # AGENTS.md 템플릿 + .codex/config.toml 생성
```

`omx setup` 후 `.codex/config.toml`에 들어갈 추가 (MCP 서버 등록):
```toml
[features]
goals = true

[mcp_servers.agent-spawner]
command = "python"
args = ["./tools/agent-spawner/server.py"]
env = { EVENT_BUS_URL = "http://localhost:4000" }
```

---

# Part 5 · 프로젝트 부트스트랩 — RALPH.md (즉시 사용)

```markdown
# Task
Build a real-time visual monitor for Codex /goal agent swarms.
The monitor shows each active agent as a distinct 2D character,
what they're doing right now, which MD files they're reading,
and how spawn relationships form between them.

# Context
- **Stack:** Bun + Hono backend, React + Vite + Tailwind frontend,
             SQLite event store, local Notion-style SVG avatars
- **Entrypoint:** apps/backend/src/index.ts, apps/ui/src/main.tsx
- **Run / Test:** bun run dev (backend), bun run dev:ui (ui),
             bun test, bun run lint
- **Domain notes:** Instruments Codex via OMX hooks (.omx/hooks/*.mjs)
                    and MCP agent-spawner. Events flow via SSE.

# Constraints
- Single-machine MVP. No cloud, no auth.
- Real-time updates < 200ms p95.
- Each agent must have a DETERMINISTIC distinct local avatar
  (avatar name = agent name).
- Backend must work without UI running (fail-safe).
- Don't modify OMX source — only add .omx/hooks/ and MCP.

# Success Criteria
- [SC-1] OMX hook 파일 작성 + Codex 실행 시 이벤트 BUS에 도달
  | Verification: `bun test apps/backend/test/hooks.test.ts` green
- [SC-2] MCP agent-spawner 등록 + Codex 안에서 `spawn_subagent` 호출 가능
  | Verification: `python tools/agent-spawner/test_spawn.py` exits 0
- [SC-3] SSE 엔드포인트 라이브, EventSource 연결 가능
  | Verification: `curl -N http://localhost:4000/stream` 즉시 응답
- [SC-4] UI에서 spawn된 에이전트가 1초 안에 카드로 나타남
  | Verification: Playwright e2e — spawn → card 등장 < 1000ms
- [SC-5] 6개 에이전트 동시 활성 + 각자 다른 로컬 SVG face 렌더
  | Verification: 시각 회귀 테스트 (`bun run test:visual`) 통과
- [SC-6] 라이브 데모 시나리오 100% 완주
  | Verification: manual — DEMO.md 스크립트 실행, 5분 무중단

# Risks & Unknowns
- OMX 훅 시그니처가 버전마다 다를 수 있음 → omx-cli docs로 정확한 이름 확인 필요
- Codex CLI가 child process로 MCP 서버 생명주기 제대로 관리하는지 검증 필요
- 외부 아바타 API 의존성 → 제거됨. `/avatar`가 로컬 SVG 생성.
- 동시 6+ codex 인스턴스 시 OpenAI rate limit 도달 (Tier 확인)

# Verification Commands
\`\`\`bash
bun test
bun run lint
bun run typecheck
bun run test:visual
python tools/agent-spawner/test_spawn.py
curl -fN http://localhost:4000/stream &
sleep 2 && kill %1
\`\`\`
```

이거 그대로 `RALPH.md`에 저장하면 OMX `$ralph "..."` 명령이 바로 작동합니다.

---

# Part 6 · AGENTS.md (즉시 사용)

```markdown
# Project Context

## What This Is
Codex Swarm Monitor — real-time visual dashboard for observing
multiple Codex agents working in parallel. Built on OMX (oh-my-codex)
with MCP agent-spawner extension.

## Stack
- Backend: Bun 1.x + Hono 4.x + better-sqlite3
- Frontend: React 18 + Vite 5 + Tailwind 3 + react-flow 11
- MCP: Python 3.11 + fastmcp
- Avatars: local Notion-style SVG generated by `/avatar`

## Directory Structure
- /apps/backend       - Event bus + SSE server
- /apps/ui            - React swarm dashboard
- /tools/agent-spawner - Python MCP server
- /.omx/hooks         - OMX lifecycle hooks (instrumentation)
- /prompts/subagents  - role-based system prompts
- /specs              - frozen requirements
- /demo               - DEMO.md + asset

## Coding Rules
- TypeScript strict mode. No `any` without comment.
- Backend handlers are pure functions where possible.
- SSE messages MUST be JSON-serializable.
- All cross-process events use SQLite events table as source of truth.

## Hard Constraints (Always/Ask/Never)
- **Never** commit `.env` files or OPENAI_API_KEY
- **Never** modify oh-my-codex source (extension only)
- **Never** call remote avatar APIs in the hot path
- **Always** include `agent_id` in every event
- **Always** ask before adding new npm dependencies
- **Always** write tests for new event types

## Key Patterns
- Event shape: { type, agent_id, timestamp, payload }
- Agent ID format: <role>-<6char-uuid>  e.g. explorer-a3f2b1
- Avatar URL: deterministic from agent name and role
- SSE message format: data: <JSON>\n\n

## Gotchas
- bun's fetch in hooks needs explicit error handling
- React Flow nodes re-render on every parent state change
  — memoize aggressively
- Local SVG avatars should keep restrained Notion-style line art
  and consistent background colors
- OMX agent_id env var is OMX_AGENT_ID — exact spelling matters
```

---

# Part 7 · 캐릭터 디자인 — 로컬 Notion-style SVG 추천

**왜 로컬 SVG**:
- **결정적**: `name=Sisyphus&role=Orchestrator`는 *언제나* 같은 얼굴
- **오프라인 가능**: 인증, CDN, rate limit 없음
- **Notion 스타일**: 얇은 선, 절제된 색, 흰 캔버스에 맞는 일러스트
- **SVG로 반환**: 픽셀 깨짐 없음, 색상 커스터마이즈 가능
- **백그라운드 색**: 역할별 파라미터로 카테고리 구분 가능

랄프톤 6 에이전트 시드 예시 (목업에서 사용 중):
```javascript
const ROSTER = {
  sisyphus:    { role: 'Orchestrator', bg: 'b6e3f4' },  // 연파랑
  athena:      { role: 'Planner',      bg: 'd1d4f9' },  // 라벤더
  hermes:      { role: 'Explorer',     bg: 'ffd5dc' },  // 핑크
  hephaestus:  { role: 'Builder',      bg: 'c0aede' },  // 보라
  argus:       { role: 'Reviewer',     bg: 'ffdfbf' },  // 살구
  themis:      { role: 'Tester',       bg: 'c0e8d5' },  // 민트
};

function avatarUrl(name, bg) {
  return `/avatar?name=${encodeURIComponent(name)}&role=${encodeURIComponent(role)}&backgroundColor=${bg}`;
}
```

대안 검토:
- 외부 아바타 API — 빠르지만 배포 안정성과 rate limit 리스크
- 픽셀아트 — 귀엽지만 프로덕션 운영 화면에는 장난스러움
- **AI 생성 (Replicate/SDXL)** — 더 독특하나 비용·시간
- **8-bit 픽셀** — 귀엽지만 표정 다양성 부족

**notionists가 랄프톤에 최적** — 빠르고 친근하고 일관성.

---

# Part 8 · MVP 범위 합의 (24시간 안에 데모 가능한 것)

**MUST HAVE** (이게 안 되면 데모 불가):
1. OMX 셋업 + 단일 /goal 실행
2. OMX 훅이 이벤트 BUS에 POST
3. SSE 스트림으로 프론트에 이벤트 푸시
4. 에이전트 카드 1개라도 라이브 업데이트
5. 로컬 SVG 아바타 렌더

**SHOULD HAVE** (시간 남으면):
6. MCP agent-spawner — 서브에이전트 자동화
7. 활성 MD 파일 패널
8. 이벤트 로그 사이드바
9. 연결 그래프 (spawn 관계)

**NICE TO HAVE** (대회 후):
10. LiteLLM 프록시 — Tier 3 네트워크 introspection
11. 토큰/비용 히트맵
12. 시간 슬라이더 (과거 시점 재생)
13. Arize 익스포터

**솔직히** 1-5만 잘 만들어도 랄프톤 상위권 가능합니다. 6-9까지 가면 우승권. 10+는 무리.

---

# Part 9 · 첫 `/goal` 명령 — 부트스트랩 시퀀스

OMX 셋업 + RALPH.md/AGENTS.md 작성 후, codex 진입해서:

```
> $deep-interview "Build the Codex Swarm Monitor per RALPH.md. 
                   Before writing any code, ask me clarifying questions
                   about: (1) which Tier 1/2/3 observability we ship in MVP, 
                   (2) whether to use Bun or Node, 
                   (3) which local avatar style I prefer, 
                   (4) demo scenario priorities."

[deep-interview가 5-10라운드 문답 진행]
[알렉스님이 답변]
[design_log.md 자동 생성]

> $ralplan "Based on the interview, create IMPLEMENTATION_PLAN.md
            with atomic tasks ordered by dependency. Each task should
            be completable in one /goal iteration."

[IMPLEMENTATION_PLAN.md 생성됨]

> $ralph "Execute IMPLEMENTATION_PLAN.md. Verify each task via
          the Verification Commands in RALPH.md. Continue until
          all SCs pass or budget exhausted."

[자율 실행 시작 — 알렉스님은 swarm-ui-mockup.html 열어두고 관찰]
```

서브에이전트가 필요한 시점에 (예: 코드베이스 탐색):
```
[Sisyphus가 자동으로]
> spawn_subagent(role="explorer", task="Find all WebSocket/SSE patterns in /apps")
```
→ MCP가 새 codex 인스턴스 띄움 → 이벤트 BUS에 spawn 이벤트 → UI에 Hermes 카드 등장 → 작업 완료 후 결과만 메인에 반환.

---

# 솔직한 어려움 + 우회법

| 도전 | 난이도 | 우회 |
|:---|:---:|:---|
| OMX 훅 시그니처 문서화 부족 | 중 | omx-cli 실행 + strace/dtrace로 역추적, 또는 `.omx/hooks/example.mjs` 참조 |
| Codex가 MCP를 child process로 잘 띄우는지 | 중 | 사전 검증 — 간단한 echo MCP로 먼저 테스트 |
| OpenAI rate limit (Tier 1~2면 동시 3개 이상 어려움) | 높 | Tier 확인. 부족하면 Anthropic Claude로 일부 서브 라우팅 |
| Arize급 네트워크 introspection | 매우 높 | LiteLLM 프록시로 절충 (Tier 3) — MVP에선 스킵 |
| Codex의 thread당 1 goal 제약 | 낮 | `$ultragoal`로 분할, 또는 서브에이전트는 별도 process |
| 6+ 캐릭터 동시 렌더 시 React 성능 | 낮 | React.memo + react-flow의 nodeTypes 사용 |

---

## 알렉스님 확인 요청

목업 보시고 다음 중 골라주세요:

**(A) 비전 일치**: "이대로 가자, 빌드 시작"  
**(B) 부분 수정**: "X는 좋은데 Y는 다르게 보이면 좋겠다"  
**(C) 캐릭터 스타일**: notionists 말고 다른 스타일 선호 (adventurer, personas, pixel-art 등)  
**(D) MVP 범위**: 위 1-5만 / 1-9까지 / 1-12 풀스택 중 선택  
**(E) 관찰성 깊이**: Tier 1+2만 / Tier 3까지 (LiteLLM 프록시)

답해주시면 다음 단계로 — *알렉스님 컴퓨터 환경에 맞춘 정확한 셋업 명령*과 *MCP agent-spawner의 첫 워킹 코드*를 만들어드립니다.

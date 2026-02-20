# Copilot Instructions

## Project Memory
Generated: 2026-02-20 10:10 UTC
Decisions: 5 active | Rejections: 0 | Entities: 38 tracked

## Active Decisions
- **Prisma as ORM** — [auto-inferred] Project imports prisma
- **Environment variables for config** — [auto-inferred] Found .env in project
- **Docker Compose for orchestration** — [auto-inferred] Found docker-compose.yml in project
- **Node.js runtime** — [auto-inferred] Found package.json in project
- **TypeScript as language** — [auto-inferred] Found tsconfig.json in project

## Entity Graph
- dependency: 14
- module: 12
- class: 7
- function: 4
- package: 1

## Rules
- No `as any`, bare `except:`, `eval()`, `exec()`, SQL concatenation
- No blanket `# type: ignore` — use specific codes
- No empty catch blocks — log errors at minimum
- No hard-to-reverse decisions without asking
- Document hardcoded values with ASSUMPTION comments
- No circular imports, no module-level mutable state

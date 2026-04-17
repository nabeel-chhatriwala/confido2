# confido2

Voice agent platform — Pipecat on GCP, Supabase for state.

Design: [docs/superpowers/specs/2026-04-17-voice-agent-infra-design.md](docs/superpowers/specs/2026-04-17-voice-agent-infra-design.md)

## Local dev

```
npm install
supabase start
supabase db reset
cp .env.example .env.local   # then fill in
npm run test
```

## Plans

- Plan A — Foundation
- Plan B — Inbound MVP
- Plan C — Provider abstraction
- Plan D — Outbound
- Plan E — Admin UI
- Plan F — IaC + CI/CD (GitLab)
- Plan G — Observability

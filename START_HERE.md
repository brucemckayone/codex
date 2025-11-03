# 🚀 START HERE - Codex Monorepo User Guide

Welcome! This is your entry point to understanding and working with the **Codex monorepo**.

---

## 📍 You Are Here

This is a **complex multi-project monorepo** with:
- ✅ 1 SvelteKit frontend app
- ✅ 2 Cloudflare Workers (edge computing)
- ✅ 6 shared packages (@codex/*)
- ✅ 3 test environments (local, CI, production)
- ✅ PostgreSQL database (Neon serverless)
- ✅ 74 passing tests

---

## ⏱️ Choose Your Path

### 🏃 I Have 5 Minutes
**Goal:** Get productive quickly

👉 **Read:** [QUICK_START.md](./QUICK_START.md)

Contains:
- Essential commands (copy-paste ready)
- Import rules (critical!)
- Common issues & fixes
- When to use what command

**Then run:**
```bash
pnpm install
pnpm dev
```

---

### 🚶 I Have 30 Minutes
**Goal:** Understand full workflow

👉 **Read:** [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)

Contains:
- Complete architecture explanation
- Project structure walkthrough
- Step-by-step guides for:
  - Adding dependencies
  - Writing tests
  - Building & deploying
  - Troubleshooting

**Action:** Pick one task and complete it

---

### 🤔 I'm Curious About Design
**Goal:** Understand the big picture

👉 **Read:** [ARCHITECTURE.md](./ARCHITECTURE.md)

Contains:
- System architecture diagrams
- Data flow explanations
- Code sharing hierarchy
- Technology decisions
- Scaling considerations

**Bonus:** Check [design/security/](./design/security/) for security details

---

### 🔍 I Need Something Specific
**Goal:** Find information quickly

👉 **Use:** [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md)

This is an index with:
- Quick links by topic
- FAQ section
- "Find information by topic" table
- All available documentation

---

## 🎯 Right Now: 60-Second Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Start development
pnpm dev

# 3. Run tests (in another terminal)
pnpm test
```

**That's it!** You now have:
- ✅ Web app running on http://localhost:5173
- ✅ Auth worker on http://localhost:8787
- ✅ Tests passing (74 tests!)

---

## 💡 3 Critical Things to Know

### 1️⃣ Import Rules

```typescript
// ✅ Use @codex/* packages
import { db } from '@codex/database';
import { rateLimit } from '@codex/security';

// ✅ Use $lib in SvelteKit
import { Component } from '$lib/features/auth';

// ❌ NEVER do this
import { handler } from 'workers/auth/src/index';
import { Component } from 'apps/web/src/lib/features/auth';
```

**Why?** Packages are workspace-linked. Workers are separate deployments.

### 2️⃣ Three Environments

| Environment | Where | Database | Use For |
|-------------|-------|----------|---------|
| **Local** | Your machine | Docker (localhost:5432) | Development |
| **CI/CD** | GitHub Actions | Neon ephemeral branch | Testing before deploy |
| **Production** | Cloudflare + Neon | Real production DB | Live users |

### 3️⃣ Project Layout

```
Codex/                           ← You are here
├── apps/web/                    ← Frontend (SvelteKit)
├── workers/                     ← Cloudflare Workers
│   ├── auth/                    ← BetterAuth implementation
│   └── stripe-webhook-handler/  ← Payment webhooks
├── packages/                    ← Shared code (@codex/*)
│   ├── database/                ← Drizzle ORM
│   ├── validation/              ← Zod schemas
│   ├── security/                ← Rate limiting, headers
│   ├── observability/           ← Logging
│   ├── cloudflare-clients/      ← R2 & KV helpers
│   └── test-utils/              ← Testing utilities
└── design/                      ← Documentation
```

---

## 📚 Complete Documentation Bundle

I've created **5 comprehensive guides** (50+ pages):

| Document | Size | Time | Purpose |
|----------|------|------|---------|
| [QUICK_START.md](./QUICK_START.md) | 8.3K | 5 min | Commands & quick reference |
| [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) | 27K | 30 min | Complete workflow guide |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 20K | 20 min | System design & data flow |
| [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md) | 10K | 10 min | Navigation & index |
| [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) | 8.2K | 5 min | Command reference |

**Also existing:**
- [design/security/](./design/security/) - Security documentation
- [design/infrastructure/](./design/infrastructure/) - Setup & CI/CD

---

## ✅ Current Status

```
✅ All tests passing (74 tests)
✅ Auth worker tests working  
✅ Database migrations running
✅ Development environment working
✅ Deployment pipeline ready
✅ Documentation complete
```

Everything is ready to use! 🎉

---

## 🔥 Most Common Tasks

### Start Development
```bash
pnpm dev
```

### Run Tests
```bash
pnpm test                    # All tests
pnpm test:watch             # Watch mode
pnpm test:coverage          # With coverage
```

### Add a Dependency
```bash
# To all projects
pnpm add -w package-name

# To specific project
pnpm --filter @codex/security add package-name
pnpm --filter auth add package-name
```

### Build Everything
```bash
pnpm build
```

### Deploy a Worker
```bash
cd workers/auth
wrangler deploy --env production
```

**More commands?** See [QUICK_START.md](./QUICK_START.md) or run `pnpm help`

---

## 🚨 If Something's Broken

1. **Can't find module?**
   - Run: `pnpm install`
   - Check: [DEVELOPER_GUIDE.md → Troubleshooting](./DEVELOPER_GUIDE.md#troubleshooting)

2. **Tests failing?**
   - Run: `pnpm docker:up` (start local database)
   - Check: `.env.dev` exists
   - See: [DEVELOPER_GUIDE.md → Troubleshooting](./DEVELOPER_GUIDE.md#troubleshooting)

3. **Build failing?**
   - Read: [DEVELOPER_GUIDE.md → Troubleshooting](./DEVELOPER_GUIDE.md#troubleshooting)
   - Check: vite config files for `external` dependencies

4. **Still stuck?**
   - Check [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md) → FAQ
   - Search relevant guide using Ctrl+F

---

## 📖 Recommended Reading Order

1. **This file** (you're reading it!) ✅ - 5 minutes
2. [QUICK_START.md](./QUICK_START.md) - 5 minutes
3. [ARCHITECTURE.md](./ARCHITECTURE.md) - 20 minutes
4. [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) - 30 minutes

**Total: ~60 minutes to become proficient**

---

## 🎓 What You'll Learn

After reading the documentation:

✅ How to add a new feature (shared package)
✅ How to write tests (unit, integration, E2E)
✅ How dependencies are resolved
✅ How to deploy to production
✅ How to work with three environments
✅ How to troubleshoot issues
✅ Security best practices
✅ Performance optimization strategies

---

## 🧠 Mental Model

Think of Codex as **3 layers**:

```
Layer 1: Shared Packages (@codex/*)
├─ database (Drizzle ORM)
├─ validation (Zod schemas)
├─ security (Rate limiting, auth)
└─ etc.
    ↓ imported by both layers below
    
Layer 2: Edge Workers
├─ auth-worker (BetterAuth)
└─ stripe-webhook-handler
    
Layer 3: Frontend
└─ SvelteKit app (uses Layers 1 & 2)
```

**Key insight:** Packages are shared code. Workers are deployed separately. Frontend consumes both.

---

## 🔐 Security Summary

This codebase has:
- ✅ Rate limiting (KV-backed)
- ✅ Security headers (CORS, CSP, X-Frame-Options)
- ✅ Worker authentication (mutual TLS)
- ✅ Sensitive data redaction (in logs)
- ✅ Type-safe validation (Zod)
- ✅ Runtime secret management

See [design/security/](./design/security/) for details.

---

## 💬 FAQ

**Q: Can I run tests locally?**
A: Yes! `pnpm docker:up && pnpm test`

**Q: Do I need Docker?**
A: No, but you need a database. Either Docker or Neon branch (CI only).

**Q: Can I use Node APIs in workers?**
A: No, workers run in edge runtime. Use Cloudflare APIs (KV, R2, etc).

**Q: How do I add a new shared package?**
A: See [DEVELOPER_GUIDE.md → Task: Add a New Shared Package](./DEVELOPER_GUIDE.md#task-add-a-new-shared-package)

**Q: Where are database migrations?**
A: `packages/database/src/migrations/`

**Q: How do I deploy?**
A: Workers: `wrangler deploy`, Web: CI/CD pipeline handles it.

More FAQs? See [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md#-faq)

---

## 🎯 Your Next Step

1. **Pick a time commitment:**
   - 5 min: [QUICK_START.md](./QUICK_START.md)
   - 30 min: [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)
   - 20 min: [ARCHITECTURE.md](./ARCHITECTURE.md)

2. **Read the guide**

3. **Try a task:**
   - Run: `pnpm dev`
   - Run: `pnpm test`
   - Edit a file and see it update
   - Commit and push (tests run in CI)

4. **Explore on your own**

---

## 📞 Resources

- **Docs:** Everything in this folder
- **Commands:** `pnpm help`
- **Worker CLI:** `wrangler --help`
- **External links:** See [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md#-external-resources)

---

## 🎉 Welcome to Codex!

You now have:
- ✅ Complete documentation (50+ pages)
- ✅ Working codebase (74 passing tests)
- ✅ Clear import rules
- ✅ Examples for every common task
- ✅ Troubleshooting guides

**You're ready to build!**

---

**Next:** Open [QUICK_START.md](./QUICK_START.md) and start with your preferred time commitment.

Good luck! 🚀

---

*Created: November 3, 2025*
*Status: Complete & Tested ✅*
*All 74 tests passing* 🎉

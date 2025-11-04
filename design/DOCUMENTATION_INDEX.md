# Codex Documentation Index

Welcome to the Codex Monorepo! This index guides you to the right documentation based on your needs.

---

## 🎯 Start Here

### If you're new to this codebase:
1. Read: [QUICK_START.md](./QUICK_START.md) (5 minutes)
2. Run: `pnpm install && pnpm dev`
3. Read: [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) for details

### If you're familiar with monorepos:
1. Skim: [ARCHITECTURE.md](./ARCHITECTURE.md) (15 minutes)
2. Reference: [QUICK_START.md](./QUICK_START.md) for commands

### If you need to understand security:
1. Read: [design/security/SECURITY_FOUNDATIONS_SUMMARY.md](./design/security/SECURITY_FOUNDATIONS_SUMMARY.md)
2. Reference: [design/security/SECURITY_IMPLEMENTATION_CHECKLIST.md](./design/security/SECURITY_IMPLEMENTATION_CHECKLIST.md)

---

## 📚 Documentation Files

### Core Documentation (Read These First)

| Document | Length | Purpose | Read When |
|----------|--------|---------|-----------|
| [QUICK_START.md](./QUICK_START.md) | 5 min | Essential commands & cheat sheet | First! Bookmark this. |
| [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) | 30 min | Complete workflow guide | Need detailed instructions |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 20 min | System design & data flow | Understanding big picture |

### Infrastructure Documentation

| Document | Purpose |
|----------|---------|
| [design/infrastructure/CICD.md](./design/infrastructure/CICD.md) | CI/CD pipeline walkthrough |
| [design/infrastructure/EnvironmentManagement.md](./design/infrastructure/EnvironmentManagement.md) | Dev/staging/prod setup |
| [design/infrastructure/CodeStructure.md](./design/infrastructure/CodeStructure.md) | Directory organization |
| [design/infrastructure/Testing.md](./design/infrastructure/Testing.md) | Testing strategy |
| [design/infrastructure/CLOUDFLARE-SETUP.md](./design/infrastructure/CLOUDFLARE-SETUP.md) | Cloudflare configuration |

### Security Documentation

| Document | Purpose |
|----------|---------|
| [design/security/SECURITY_FOUNDATIONS_SUMMARY.md](./design/security/SECURITY_FOUNDATIONS_SUMMARY.md) | Security overview |
| [design/security/SECURITY_IMPLEMENTATION_CHECKLIST.md](./design/security/SECURITY_IMPLEMENTATION_CHECKLIST.md) | Implementation tasks |
| [design/security/SECURITY_QUICK_REFERENCE.md](./design/security/SECURITY_QUICK_REFERENCE.md) | Quick reference |
| [packages/security/README.md](./packages/security/README.md) | Security package docs |

### Worker Documentation

| Document | Purpose |
|----------|---------|
| [workers/auth/README.md](./workers/auth/README.md) | Auth worker setup |
| [workers/stripe-webhook-handler/README.md](./workers/stripe-webhook-handler/README.md) | Stripe webhook handler |

---

## 🔍 Find Information By Topic

### Getting Started
- **First 5 minutes:** [QUICK_START.md](./QUICK_START.md)
- **Setup instructions:** [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md#quick-start)
- **Understanding structure:** [design/infrastructure/CodeStructure.md](./design/infrastructure/CodeStructure.md)

### Adding Code
- **New shared package:** [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md#task-add-a-new-shared-package)
- **New worker:** [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) (not yet documented, check template)
- **Add dependencies:** [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md#adding-dependencies)

### Writing Tests
- **Test structure:** [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md#writing-tests)
- **Test types:** [design/infrastructure/Testing.md](./design/infrastructure/Testing.md)
- **Database testing:** [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md#integration-tests-for-packages-with-services)
- **Worker testing:** [workers/auth/src/index.test.ts](./workers/auth/src/index.test.ts) (example)

### Environment Setup
- **Environment variables:** [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md#environment-variables)
- **Database connection:** [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md#database-connection-methods)
- **Dev/prod setup:** [design/infrastructure/EnvironmentManagement.md](./design/infrastructure/EnvironmentManagement.md)

### Building & Deployment
- **Build processes:** [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md#building--deployment)
- **Deploy workers:** [QUICK_START.md](./QUICK_START.md#-deployment)
- **CI/CD pipeline:** [design/infrastructure/CICD.md](./design/infrastructure/CICD.md)

### Troubleshooting
- **Common issues:** [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md#troubleshooting)
- **Quick fixes:** [QUICK_START.md](./QUICK_START.md#-common-issues--fixes)

### Security
- **Security overview:** [design/security/SECURITY_FOUNDATIONS_SUMMARY.md](./design/security/SECURITY_FOUNDATIONS_SUMMARY.md)
- **Implementation:** [design/security/SECURITY_IMPLEMENTATION_CHECKLIST.md](./design/security/SECURITY_IMPLEMENTATION_CHECKLIST.md)
- **Quick reference:** [design/security/SECURITY_QUICK_REFERENCE.md](./design/security/SECURITY_QUICK_REFERENCE.md)
- **Security package:** [packages/security/README.md](./packages/security/README.md)

---

## 💡 Common Tasks

### Development Workflow
```bash
# See: QUICK_START.md → Essential Commands → Development
pnpm dev                    # Start everything
pnpm test                   # Run all tests
pnpm format                 # Format code
```

### Add a Feature
```bash
# 1. Create new package: DEVELOPER_GUIDE.md → Task: Add a New Shared Package
# 2. Write code and tests
# 3. Build: pnpm build:packages
# 4. Deploy: pnpm deploy (for workers)
```

### Debug a Test Failure
```bash
# See: DEVELOPER_GUIDE.md → Troubleshooting
pnpm test -- --reporter=verbose
# Check environment with: cat .env.dev
# Ensure DB is running: pnpm docker:up
```

### Deploy Changes
```bash
# See: DEVELOPER_GUIDE.md → Building & Deployment
pnpm test                   # Verify tests pass
pnpm build                  # Build all
pnpm --filter auth build && wrangler deploy  # Deploy worker
```

---

## 🗂️ Project Structure at a Glance

```
Codex/
├── apps/web/                    ← SvelteKit frontend
├── workers/                     ← Cloudflare Workers
│   ├── auth/                    ← BetterAuth implementation
│   └── stripe-webhook-handler/  ← Stripe webhooks
├── packages/                    ← Shared code (@codex/*)
│   ├── database/                ← Drizzle ORM + schemas
│   ├── validation/              ← Zod schemas
│   ├── security/                ← Rate limiting, headers
│   ├── observability/           ← Logging
│   ├── cloudflare-clients/      ← R2 & KV helpers
│   └── test-utils/              ← Testing utilities
├── design/                      ← Architecture & docs
│   ├── infrastructure/          ← Setup & CI/CD
│   └── security/                ← Security docs
└── infrastructure/              ← Docker, configs
```

---

## 🚀 Quick Command Reference

**See [QUICK_START.md](./QUICK_START.md) for full list**

```bash
# Setup
pnpm install

# Development
pnpm dev              # Everything
pnpm dev:web          # Just frontend
pnpm test             # Run tests
pnpm format           # Format code

# Building
pnpm build            # Build all
pnpm --filter auth build

# Database
pnpm docker:up        # Start local DB
pnpm db:push          # Run migrations
pnpm db:studio        # Open database GUI

# Deployment
cd workers/auth && wrangler deploy
```

---

## 📖 Reading Order (Recommended)

**New to the project?**
1. [QUICK_START.md](./QUICK_START.md) - Get productive immediately
2. [ARCHITECTURE.md](./ARCHITECTURE.md) - Understand the design
3. [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) - Learn detailed workflows

**Need specific information?**
- Use the "Find Information By Topic" section above
- Search for your task name (e.g., "Add a New Shared Package")
- Check the QUICK_START.md cheat sheet

**Deep diving into security?**
1. [design/security/SECURITY_FOUNDATIONS_SUMMARY.md](./design/security/SECURITY_FOUNDATIONS_SUMMARY.md)
2. [design/security/SECURITY_IMPLEMENTATION_CHECKLIST.md](./design/security/SECURITY_IMPLEMENTATION_CHECKLIST.md)
3. [packages/security/README.md](./packages/security/README.md)

**Understanding CI/CD?**
1. [design/infrastructure/CICD.md](./design/infrastructure/CICD.md)
2. Check `.github/workflows/` for actual pipeline
3. [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md#building--deployment) for deployment details

---

## ❓ FAQ

**Q: How do I add a new dependency?**
A: See [DEVELOPER_GUIDE.md → Adding Dependencies](./DEVELOPER_GUIDE.md#adding-dependencies)

**Q: How do I write tests?**
A: See [DEVELOPER_GUIDE.md → Writing Tests](./DEVELOPER_GUIDE.md#writing-tests)

**Q: How do tests access the database?**
A: See [DEVELOPER_GUIDE.md → Environment Variables](./DEVELOPER_GUIDE.md#environment-variables)

**Q: Can I use Node APIs in workers?**
A: No, workers are edge runtime. Use Cloudflare APIs (KV, R2, Durable Objects).

**Q: How do I debug a test?**
A: See [DEVELOPER_GUIDE.md → Troubleshooting](./DEVELOPER_GUIDE.md#troubleshooting)

**Q: What's the difference between packages and workers?**
A: [ARCHITECTURE.md → Code Sharing Architecture](./ARCHITECTURE.md#code-sharing-architecture)

**Q: How do I deploy?**
A: [DEVELOPER_GUIDE.md → Deployment Workflow](./DEVELOPER_GUIDE.md#deployment-workflow)

---

## 🔗 External Resources

- **Vitest:** https://vitest.dev/
- **SvelteKit:** https://kit.svelte.dev/
- **Drizzle ORM:** https://orm.drizzle.team/
- **Hono:** https://hono.dev/
- **Cloudflare Workers:** https://workers.cloudflare.com/
- **Neon Database:** https://neon.tech/
- **BetterAuth:** https://www.better-auth.com/
- **Zod:** https://zod.dev/

---

## 📝 Contributing Guidelines

Before submitting code:
1. Read [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)
2. Follow import rules in [DEVELOPER_GUIDE.md → Project Structure](./DEVELOPER_GUIDE.md#project-structure)
3. Write tests alongside code
4. Run `pnpm format && pnpm typecheck && pnpm test`

---

## 🆘 Getting Help

1. **Quick answer?** Check [QUICK_START.md](./QUICK_START.md)
2. **Detailed guide?** Read [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md)
3. **System design?** Study [ARCHITECTURE.md](./ARCHITECTURE.md)
4. **Specific topic?** Use the "Find Information By Topic" section
5. **Still stuck?** Check [DEVELOPER_GUIDE.md → Troubleshooting](./DEVELOPER_GUIDE.md#troubleshooting)

---

**Last Updated:** November 3, 2025
**Current Status:** ✅ All systems working
**Test Coverage:** 74 passing tests, 2 skipped, 13 todo

📚 **Start with [QUICK_START.md](./QUICK_START.md) - you'll be productive in 5 minutes!**

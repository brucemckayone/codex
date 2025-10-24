# Act - Local GitHub Actions Testing

✅ **Setup Complete & Verified** - Act is working correctly and catching type errors before push!

Test your GitHub Actions workflows locally before pushing. Act is the industry standard tool for this.

## Quick Start

### 1. Start Test Database
```bash
pnpm docker:test:up
```

### 2. List Workflows
```bash
act -l
```

### 3. Run Tests Locally
```bash
# Run the test job (unit + integration tests)
act -j test

# Dry run (see what would execute)
act -n
```

## Configuration

### `.actrc`
- Uses `catthehacker/ubuntu:act-latest` image (includes Node.js 20, pnpm, common tools)
- Loads secrets from `.secrets` file
- Uses host network (`--network host`) so containers can access `localhost:5433` postgres

### `.secrets`
Contains environment variables for workflows (gitignored):
```
# Use host.docker.internal to connect from act container to host postgres
DATABASE_URL=postgresql://codex_test:codex_test_password@host.docker.internal:5433/codex_test
GITHUB_TOKEN=
CODECOV_TOKEN=
```

**Important:** The DATABASE_URL uses `host.docker.internal` instead of `localhost` because act runs inside Docker and needs to reach your host machine's postgres container.

Copy from `.secrets.example` and customize as needed.

## Common Commands

```bash
# List all workflows and jobs
act -l

# Run specific job
act -j test

# Run all jobs for push event
act push

# Run pull_request event
act pull_request

# Verbose output for debugging
act -j test --verbose

# Dry run
act -n

# Rebuild without cache
act -j test --pull
```

## Workflow Support

### ✅ What Works Great
- **Unit & Integration Tests** - Full support for vitest, node environment
- **Type Checking** - TypeScript, ESLint, Prettier
- **Service Containers** - Postgres works via host network mode
- **Caching** - pnpm cache works (may be slower than GitHub)
- **Environment Variables** - Full support via `.secrets`
- **Most Actions** - `actions/checkout`, `actions/cache`, `pnpm/action-setup`, etc.

### ⚠️ Known Differences
- **Codecov Upload** - Skip in local testing (action will warn but not fail)
- **First Run** - Docker image download (~10GB, one-time)
- **Speed** - Slightly slower than GitHub runners due to emulation
- **E2E Tests** - Branch condition may skip (`if: github.ref == 'refs/heads/main'`)

### 💡 Tips

**Skip E2E Branch Check:**
Temporarily remove or modify the `if` condition in [.github/workflows/test.yml](.github/workflows/test.yml):
```yaml
# Remove or comment this line for local testing
# if: github.ref == 'refs/heads/main' || github.ref == 'refs/heads/develop'
```

**Speed Up Runs:**
Skip coverage for faster local tests:
```bash
# Modify workflow temporarily to use `pnpm test` instead of `pnpm test:coverage`
```

**Debug Environment:**
```bash
# See all environment variables
act -j test --env

# Get shell access to runner
act -j test --shell
```

## Testing Workflow

### Before Pushing Changes

```bash
# 1. Start database
pnpm docker:test:up

# 2. Check what will run
act -l

# 3. Run tests
act -j test

# 4. If successful, commit and push
git add .
git commit -m "Your changes"
git push
```

### Debugging Failures

```bash
# Run with verbose output
act -j test --verbose

# Check if postgres is accessible
docker ps  # Should show codex-postgres-test

# Verify secrets are loaded
cat .secrets

# Test database connection
psql postgresql://codex_test:codex_test_password@localhost:5433/codex_test -c "SELECT 1"
```

## Project Structure Compliance

This setup follows project conventions per [CodeStructure.md](../../design/infrastructure/CodeStructure.md):
- Monorepo with pnpm workspaces
- Feature-based organization
- Shared packages

Per [Testing.md](../../design/infrastructure/Testing.md):
- Unit tests (Vitest)
- Integration tests (Miniflare)
- E2E tests (Playwright)

Per [CI-CD-Pipeline.md](../../design/infrastructure/CI-CD-Pipeline.md):
- Tests run on push/PR
- Type checking, linting, formatting
- Coverage reporting

## Alternative: Just Push

If act feels like overkill for simple changes:
1. Create a draft PR
2. Let GitHub Actions run
3. Iterate based on results

Act is most valuable for:
- Complex workflow changes
- Debugging CI failures
- Testing before important releases

## Setup Summary

**What was configured:**
- `.actrc` - Main config, `.secrets` - Environment vars (gitignored)
- npm scripts: `act:list`, `act:test`, `act:test:verbose`, `act:dry`
- Added `typescript@^5.9.3` to support type checking
- Fixed workflow: removed redundant pnpm version (uses `packageManager` from package.json)

**Verification:** Act successfully runs all workflow steps and catches TypeScript errors before push.

## Resources

- [Act GitHub Repository](https://github.com/nektos/act)
- [GitHub Actions Docs](https://docs.github.com/actions)

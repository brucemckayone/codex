# Act Setup - Local GitHub Actions Testing

This document explains how to test GitHub Actions workflows locally using [Act](https://github.com/nektos/act).

## Prerequisites

1. **Install Act**:
   ```bash
   brew install act
   ```

2. **Install Docker Desktop** (required by Act):
   - Download from https://www.docker.com/products/docker-desktop

## Configuration Files

Act is configured through several files in the repository:

- **`.actrc`**: Main Act configuration (image, secrets, environment)
- **`.secrets`**: GitHub secrets (API keys, tokens) - **NEVER commit this file**
- **`.github/.env.act`**: GitHub variables (project IDs, configuration)

## Quick Start

### List Available Workflows

```bash
pnpm act:list
```

This shows all jobs in your workflows.

### Run the Test Job Locally

```bash
pnpm act:test
```

This runs the `test` job from the workflow, which:
1. Creates a Neon ephemeral branch
2. Runs type checking, linting, and formatting checks
3. Runs migrations on the ephemeral branch
4. Runs all package tests
5. Cleans up the ephemeral branch

### Run with Verbose Output

```bash
pnpm act:test:verbose
```

### Dry Run (see what would happen without executing)

```bash
pnpm act:dry
```

## Testing Specific Workflows

### Test Only Database Package

To test just the database connection and migrations:

```bash
act -j test --matrix node:20
```

### Test E2E Tests

```bash
act -j e2e-tests
```

## Environment Variables

Act uses different sources for environment variables:

1. **Secrets** (from `.secrets` file):
   - `NEON_API_KEY`: API key for creating Neon branches
   - `STRIPE_SECRET_KEY`: For E2E tests
   - `GITHUB_TOKEN`: Optional, for GitHub API calls

2. **Variables** (from `.github/.env.act`):
   - `NEON_PROJECT_ID`: Your Neon project identifier

3. **Workflow Environment Variables**:
   - Set directly in the workflow YAML files

## Troubleshooting

### Act Can't Find Workflows

Make sure you're running Act from the repository root:

```bash
cd /Users/brucemckay/development/Codex
pnpm act:test
```

### Docker Issues

If Act fails with Docker errors:

1. Ensure Docker Desktop is running
2. Try pulling the image manually:
   ```bash
   docker pull catthehacker/ubuntu:act-latest
   ```

### Neon Branch Creation Fails

1. Verify `.secrets` has a valid `NEON_API_KEY`
2. Verify `.github/.env.act` has the correct `NEON_PROJECT_ID`
3. Check Neon API key permissions in your Neon console

### Tests Fail with Database Connection Errors

The workflow should:
1. Create a Neon branch
2. Set `DATABASE_URL` from the branch output
3. Set `DB_METHOD=NEON_BRANCH`
4. Run migrations before tests

If this fails, check:
- The `create-neon-branch` job completed successfully
- The `DATABASE_URL` environment variable is set correctly
- Migrations ran without errors

## CI/CD Workflow Overview

### Main Workflow: `testing.yml`

1. **changes**: Detects which packages have changed
2. **create-neon-branch**: Creates ephemeral Neon database branch
3. **test**: Runs type checks, linting, formatting, migrations, and tests
4. **e2e-tests**: Runs Playwright E2E tests (if web app changed)
5. **cleanup-neon-branch**: Deletes the ephemeral branch (runs always)
6. **deploy-workers**: Deploys to Cloudflare Workers (only on main branch)

### Testing Strategy

The workflow uses Neon's ephemeral branch feature to:
- Create an isolated database for each CI run
- Run migrations on fresh database
- Run all tests with real database
- Automatically clean up after tests complete

This approach is faster and more cost-effective than:
- Docker Postgres in CI (slow to start)
- Persistent test databases (requires cleanup management)
- Mocked databases (doesn't test real SQL)

## Local Development Workflow

For local development, you typically use:

```bash
# Start local Neon proxy with Docker
pnpm docker:up

# Run development server
pnpm dev

# Run tests against local proxy
DB_METHOD=LOCAL_PROXY pnpm test
```

For testing the CI environment locally:

```bash
# Test with Act (uses ephemeral Neon branch)
pnpm act:test
```

## Best Practices

1. **Always run Act tests before pushing** to catch CI failures early
2. **Keep secrets file secure** - it's in `.gitignore` for a reason
3. **Use descriptive branch names** - they appear in Neon console
4. **Monitor Neon branch usage** - ephemeral branches auto-cleanup but check occasionally
5. **Update documentation** when changing workflows

## Additional Resources

- [Act Documentation](https://github.com/nektos/act)
- [Neon Branching Guide](https://neon.com/docs/guides/branching-github-actions)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)

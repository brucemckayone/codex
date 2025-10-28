# Database Configuration Guide

This guide explains how to configure database connections for different environments and testing scenarios.

## Database Connection Methods

The `DB_METHOD` environment variable controls which database connection method to use:

### 1. `LOCAL` - Local Development Database

```bash
DB_METHOD=LOCAL
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/main
```

- Uses a local PostgreSQL instance (Docker Compose)
- For regular development work
- Fastest for local development

### 2. `EPHEMERAL` - Neon Local (Docker)

```bash
DB_METHOD=EPHEMERAL
DATABASE_URL_PROXY=postgres://neon:npg@localhost:5432/neondb
```

- Uses Neon Local Docker container
- Simulates Neon's serverless environment locally
- Good for testing Neon-specific features

### 3. `BRANCH` - Neon Ephemeral Branch

```bash
DB_METHOD=BRANCH
# DATABASE_URL is set automatically by the branch manager
```

- Creates a real Neon ephemeral branch for testing
- Requires Neon API credentials
- Used for integration testing with real Neon infrastructure

### 4. `CI` - CI/CD Environment

```bash
DB_METHOD=CI
# DATABASE_URL is set by GitHub Actions workflow
```

- Same as BRANCH but optimized for CI/CD
- Used in GitHub Actions workflows

## Required Environment Variables

### For All Methods:

```bash
DB_METHOD=LOCAL|EPHEMERAL|BRANCH|CI
```

### For Neon Methods (BRANCH/CI):

```bash
NEON_API_KEY=your_neon_api_key
NEON_PROJECT_ID=your_project_id
NEON_PARENT_BRANCH_ID=your_main_branch_id
```

### For LOCAL:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/main
```

### For EPHEMERAL:

```bash
DATABASE_URL_PROXY=postgres://neon:npg@localhost:5432/neondb
```

## How Ephemeral Branch Testing Works

When you use `DB_METHOD=BRANCH` or `DB_METHOD=CI`:

1. **Branch Manager Creates Branch**: The `NeonBranchManager` creates a new ephemeral branch from your main branch
2. **Automatic URL Setting**: The branch manager automatically sets `DATABASE_URL` with the connection string from the new branch
3. **Database Connection**: Your application connects to the ephemeral branch using the automatically set URL
4. **Automatic Cleanup**: The branch is deleted after testing (manual cleanup or CI cleanup)

### Example Workflow:

```bash
# 1. Set up environment
export DB_METHOD=BRANCH
export NEON_API_KEY=your_key
export NEON_PROJECT_ID=your_project
export NEON_PARENT_BRANCH_ID=your_main_branch

# 2. Create ephemeral branch (automatically sets DATABASE_URL)
pnpm neon:create my-test-branch

# 3. Run tests (uses the automatically set DATABASE_URL)
pnpm test:neon

# 4. Clean up
pnpm neon:cleanup
```

## Database URL Formats

### Local PostgreSQL:

```
postgresql://postgres:postgres@localhost:5432/main
```

### Neon Local (Docker):

```
postgres://neon:npg@localhost:5432/neondb
```

### Neon Ephemeral Branch:

```
postgresql://neondb_owner:password@ep-cool-name-123456.us-east-2.aws.neon.build/neondb?sslmode=require
```

## Commands Reference

### Neon Branch Management:

```bash
# Create ephemeral branch
pnpm neon:create [branch-name]

# List all branches
pnpm neon:list

# Delete specific branch
pnpm neon:delete <branch-id>

# Clean up old branches
pnpm neon:cleanup

# Run tests with ephemeral branch
pnpm test:neon
```

### Database Operations:

```bash
# Generate migrations
pnpm db:gen

# Push schema changes
pnpm db:push

# Open Drizzle Studio
pnpm db:studio
```

## Troubleshooting

### "Missing required environment variables" Error:

- Ensure `NEON_API_KEY`, `NEON_PROJECT_ID`, and `NEON_PARENT_BRANCH_ID` are set
- Get these from Neon Console → Settings → API Keys

### "Branch not ready" Error:

- Ephemeral branches take time to initialize
- The branch manager waits up to 60 seconds
- Check your Neon project status in the console

### Connection Issues:

- Verify `DB_METHOD` is set correctly
- Check that `DATABASE_URL` is set (for BRANCH/CI methods)
- Ensure your Neon project is active

## Best Practices

1. **Development**: Use `LOCAL` for regular development
2. **Neon Testing**: Use `EPHEMERAL` for testing Neon-specific features locally
3. **Integration Testing**: Use `BRANCH` for testing with real Neon infrastructure
4. **CI/CD**: Use `CI` in GitHub Actions workflows
5. **Cleanup**: Always clean up ephemeral branches after testing
6. **Credentials**: Never commit Neon API keys to version control

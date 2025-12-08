# E2E Debugging Guide

## Overview

This guide explains how to debug Playwright E2E tests and Cloudflare Workers simultaneously using VS Code's debugger.

## Quick Start

### Option 1: Debug All Workers
1. Open VS Code Debug panel (Ctrl/Cmd + Shift + D)
2. Select "E2E: All Workers + Tests" from dropdown
3. Click Start Debugging (F5)
4. Workers will start automatically, debugger will attach
5. Run your Playwright tests manually or use "Debug Playwright E2E Tests" configuration

### Option 2: Debug Specific Flow
Choose from these compound configurations:
- **E2E: Auth Flow (Worker + Tests)** - Auth worker only
- **E2E: Content Flow (Workers + Tests)** - Auth + Content workers
- **E2E: Ecom Flow (Workers + Tests)** - Auth + Ecom workers

### Option 3: Debug Individual Worker
1. Select individual worker configuration (e.g., "Auth Worker")
2. Click Start Debugging (F5)
3. Worker starts automatically via preLaunchTask
4. Set breakpoints in worker code

## Debugging Workflow

### 1. Set Breakpoints in Workers

```typescript
// workers/auth/src/index.ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    debugger; // Breakpoint here
    const url = new URL(request.url);
    // ...
  }
}
```

### 2. Set Breakpoints in Tests

```typescript
// e2e/tests/01-auth-flow.spec.ts
test('should register new user', async ({ request }) => {
  debugger; // Breakpoint here
  const registered = await authFixture.registerUser(request, {
    email: testEmail,
    password: testPassword,
  });
  // ...
});
```

### 3. Run Tests with Debugging

**Option A: Use Playwright Inspector**
```bash
pnpm test:e2e:api:debug
```

**Option B: Use VS Code**
1. Start worker debugger: F5 with worker configuration selected
2. Wait for "Debugger attached" message
3. Run test in another terminal or use "Debug Playwright E2E Tests" configuration

### 4. Debugging Tips

**Workers:**
- Each worker has its own debug port (9231-9234)
- Source maps enabled for TypeScript debugging
- Use `restart: true` to reattach on worker restart
- Check worker terminal for "Debugger listening" message

**Tests:**
- Playwright Inspector provides step-through UI
- Use `--debug` flag for interactive debugging
- `--headed` flag shows browser UI (not applicable for API tests)
- Use `test.only()` to debug single test

## Debug Port Assignment

| Worker | Port | Inspector Port |
|--------|------|----------------|
| Auth | 42069 | 9231 |
| Ecom-API | 42072 | 9232 |
| Content-API | 4001 | 9233 |
| Identity-API | 42071 | 9234 |

## Common Issues

### Workers Not Starting
**Problem:** "Cannot connect to runtime process"
**Solution:** Check if workers are running. Start manually with `pnpm dev:auth`, etc.

### Breakpoints Not Hit
**Problem:** Breakpoints shown as gray/unverified
**Solution:**
- Ensure source maps are enabled in worker build config
- Check `outFiles` path in launch.json matches build output
- Restart VS Code debugger

### Port Already in Use
**Problem:** "EADDRINUSE: address already in use"
**Solution:** Kill existing worker process:
```bash
lsof -ti:42069 | xargs kill -9  # Auth worker
lsof -ti:42072 | xargs kill -9  # Ecom-API worker
# etc.
```

### Multiple Debuggers Attached
**Problem:** Can't attach to worker inspector port
**Solution:** Only one debugger can attach at a time. Close other debug sessions.

## Advanced Usage

### Debug Specific Test File

1. Open test file (e.g., `e2e/tests/01-auth-flow.spec.ts`)
2. Select "Debug Current Playwright Test" configuration
3. Press F5
4. Only tests in current file will run in debug mode

### Debug with Custom Args

Modify launch configuration:
```json
{
  "name": "Debug Playwright E2E Tests",
  "type": "node",
  "request": "launch",
  "program": "${workspaceFolder}/node_modules/.bin/playwright",
  "args": [
    "test",
    "--config",
    "e2e/playwright.config.ts",
    "--debug",
    "--grep", "auth"  // Add custom filter
  ]
}
```

### Debug Worker Code Changes

Workers auto-reload on code changes:
1. Leave debugger attached
2. Edit worker code
3. Save file
4. Worker rebuilds and restarts
5. Debugger reattaches automatically (thanks to `restart: true`)

### Conditional Breakpoints

Right-click breakpoint → Edit Breakpoint → Add condition:
```typescript
// Break only when email contains "test"
email.includes('test')

// Break on specific request
request.url.includes('/api/auth/login')
```

## NPM Scripts Reference

| Command | Description |
|---------|-------------|
| `pnpm test:e2e:api` | Run E2E tests (no debug) |
| `pnpm test:e2e:api:debug` | Run with Playwright Inspector |
| `pnpm test:e2e:api:ui` | Run with Playwright UI |
| `pnpm test:e2e:api:headed` | Run with visible browser (N/A for API tests) |
| `pnpm dev:auth` | Start auth worker |
| `pnpm dev:ecom-api` | Start ecom-api worker |
| `pnpm dev:content-api` | Start content-api worker |
| `pnpm dev:identity-api` | Start identity-api worker |

## VS Code Tasks Reference

Run tasks via Command Palette (Ctrl/Cmd + Shift + P) → "Tasks: Run Task":

- **Start All Workers (debug)** - Starts all 4 workers with debug enabled
- **Start Auth Worker (debug)** - Individual worker startup
- **Start Ecom-API Worker (debug)** - Individual worker startup
- **Start Content-API Worker (debug)** - Individual worker startup
- **Start Identity-API Worker (debug)** - Individual worker startup

## Example Debugging Session

1. **Setup:**
   ```bash
   # Terminal 1: Start all workers
   pnpm dev
   ```

2. **Attach Debugger:**
   - VS Code → Debug panel
   - Select "E2E: All Workers + Tests"
   - Press F5

3. **Set Breakpoints:**
   - Open `workers/auth/src/index.ts`
   - Set breakpoint on line where request is processed
   - Open `e2e/tests/01-auth-flow.spec.ts`
   - Set breakpoint on test line

4. **Run Test:**
   ```bash
   # Terminal 2: Run single test
   pnpm test:e2e:api -- --grep "should register new user"
   ```

5. **Debug Flow:**
   - Test hits breakpoint
   - Step through test code
   - Test makes HTTP request to worker
   - Worker breakpoint hits
   - Step through worker code
   - Inspect request/response
   - Continue execution

## Resources

- [Playwright Debugging Docs](https://playwright.dev/docs/debug)
- [VS Code Debugging Guide](https://code.visualstudio.com/docs/editor/debugging)
- [Cloudflare Workers Debugging](https://developers.cloudflare.com/workers/testing/debugging/)
- [Node.js Inspector Protocol](https://nodejs.org/en/docs/guides/debugging-getting-started/)

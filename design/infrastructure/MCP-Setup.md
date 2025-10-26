# Model Context Protocol (MCP) Setup

Learn how to extend Claude Desktop with local MCP servers to enable enhanced development workflows and integrations for the Codex project.

## Overview

Model Context Protocol (MCP) servers extend AI applications' capabilities by providing secure, controlled access to local resources and tools. This guide demonstrates how to configure Claude Desktop to work with MCP servers for improved development productivity.

## Benefits for Codex Development

Using MCP servers with Claude Desktop provides:

- **File System Access**: Read and modify project files with AI assistance
- **Codebase Navigation**: Search and explore the Codex monorepo structure
- **Development Tools**: Access to build tools, test runners, and linters
- **Database Integration**: Query and manage development databases
- **API Testing**: Interact with local API endpoints during development

All operations require explicit approval, ensuring you maintain full control.

## Prerequisites

Before setting up MCP servers, ensure you have:

### Claude Desktop

Download and install [Claude Desktop](https://claude.ai/download) for your operating system (macOS or Windows).

If already installed, verify you're running the latest version:
- Click the Claude menu → "Check for Updates..."

### Node.js

MCP servers require Node.js. Verify installation:

```bash
node --version
```

If not installed, download from [nodejs.org](https://nodejs.org/) (LTS version recommended).

## Recommended MCP Servers for Codex

### 1. Filesystem Server (Essential)

Provides file and directory operations for the Codex codebase.

**Capabilities:**
- Read file contents and directory structures
- Create new files and directories
- Move and rename files
- Search for files by name or content

**Use Cases:**
- Reading design documents while implementing features
- Creating new components and tests
- Organizing project files
- Searching for specific code patterns

### 2. GitHub Server (Recommended)

Integrates with GitHub for repository operations.

**Capabilities:**
- Create and manage pull requests
- View issues and discussions
- Review code changes
- Manage branches

**Use Cases:**
- Creating PRs for feature branches
- Reviewing GitHub Actions workflow results
- Managing project issues

### 3. PostgreSQL Server (Optional)

Direct database access for development.

**Capabilities:**
- Query database schemas
- Read table data
- Execute SQL queries
- Inspect database structure

**Use Cases:**
- Debugging database issues
- Exploring schema structure
- Testing queries before implementation

## Installation Guide

### Step 1: Open Claude Desktop Settings

1. Click the Claude menu in your system's menu bar
2. Select "Settings..."
3. Navigate to the "Developer" tab
4. Click "Edit Config"

This opens the configuration file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### Step 2: Configure MCP Servers

#### Minimal Configuration (Filesystem Only)

Replace the file contents with this configuration, adjusting paths to your Codex project:

<CodeGroup>

```json macOS
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/username/development/Codex"
      ]
    }
  }
}
```

```json Windows
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "C:\\Users\\username\\development\\Codex"
      ]
    }
  }
}
```

</CodeGroup>

**Important:** Replace `username` with your actual username and adjust the path to match your Codex installation location.

#### Full Configuration (Filesystem + GitHub)

For enhanced functionality, add the GitHub server:

<CodeGroup>

```json macOS
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/username/development/Codex"
      ]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your_github_token_here"
      }
    }
  }
}
```

```json Windows
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "C:\\Users\\username\\development\\Codex"
      ]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your_github_token_here"
      }
    }
  }
}
```

</CodeGroup>

**GitHub Token:** Create a personal access token at [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens) with `repo` and `workflow` scopes.

### Step 3: Restart Claude Desktop

1. Completely quit Claude Desktop
2. Restart the application
3. Look for the MCP server indicator (hammer icon) in the bottom-right corner

Click the indicator to view available tools from connected servers.

## Security Considerations

### Directory Access Control

Only grant access to directories you're comfortable with Claude reading and modifying:

✅ **Safe to include:**
- Your Codex project directory
- Development workspace folders
- Documentation directories

❌ **Avoid including:**
- System directories
- Sensitive configuration folders
- Directories containing secrets or credentials

### Token Management

- **Never commit** `claude_desktop_config.json` to version control
- Store GitHub tokens securely
- Use environment variables for sensitive values when possible
- Rotate tokens periodically

### Approval Workflow

Every MCP server operation requires explicit approval before execution. Review each request carefully:

- **File modifications**: Check paths and content before approving
- **API calls**: Verify the operation and parameters
- **Database queries**: Review SQL before execution

## Common Use Cases for Codex Development

### Example 1: Feature Implementation

```
Prompt: "Read the PDR document for the auth feature in design/features/auth/pdr-phase-1.md
and help me implement the user registration endpoint following the architecture"
```

Claude will:
1. Request approval to read the PDR document
2. Analyze the requirements
3. Request approval to read existing code structure
4. Suggest implementation with file creation/modification

### Example 2: Test Creation

```
Prompt: "Create unit tests for the validation schemas in packages/validation/src/user-schema.ts"
```

Claude will:
1. Read the existing schema file
2. Generate appropriate test cases
3. Request approval to create test file
4. Create tests following project conventions

### Example 3: Documentation Updates

```
Prompt: "Update the README in packages/database to reflect the current schema structure"
```

Claude will:
1. Read current schema files
2. Read existing README
3. Generate updated documentation
4. Request approval to modify README

### Example 4: GitHub Workflow

```
Prompt: "Create a pull request for the feature/ci-cd branch to main with a summary
of the CI/CD pipeline implementation"
```

Claude will:
1. Analyze git diff
2. Generate PR description
3. Request approval to create PR via GitHub API

## Troubleshooting

### Server Not Showing Up

**Symptoms:** No MCP indicator in Claude Desktop

**Solutions:**
1. Verify configuration file syntax (valid JSON)
2. Check that file paths are absolute, not relative
3. Restart Claude Desktop completely
4. View logs for errors (see below)

**Test manually:**

<CodeGroup>

```bash macOS/Linux
npx -y @modelcontextprotocol/server-filesystem /Users/username/development/Codex
```

```powershell Windows
npx -y @modelcontextprotocol/server-filesystem C:\Users\username\development\Codex
```

</CodeGroup>

### Viewing Logs

**macOS:**
```bash
tail -n 20 -f ~/Library/Logs/Claude/mcp*.log
```

**Windows:**
```powershell
type "%APPDATA%\Claude\logs\mcp*.log"
```

Log files:
- `mcp.log` - General MCP connection logging
- `mcp-server-SERVERNAME.log` - Server-specific error logs

### Tool Calls Failing

If operations fail silently:

1. Check Claude's logs for error messages
2. Verify file permissions for target directories
3. Test server manually (see above)
4. Restart Claude Desktop
5. Check that Node.js and npx are in PATH

### Windows ENOENT Error

If you see `${APPDATA}` in error messages, add the expanded path to your config:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\username\\development\\Codex"],
      "env": {
        "APPDATA": "C:\\Users\\username\\AppData\\Roaming\\"
      }
    }
  }
}
```

Ensure npm is installed globally:
```bash
npm install -g npm
```

## Advanced Configuration

### Multiple Project Directories

Grant access to multiple directories:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/username/development/Codex",
        "/Users/username/development/other-project",
        "/Users/username/Documents/design-docs"
      ]
    }
  }
}
```

### Custom Server Scripts

For project-specific tools, create a custom MCP server:

```json
{
  "mcpServers": {
    "codex-tools": {
      "command": "node",
      "args": ["/Users/username/development/Codex/scripts/mcp-server.js"]
    }
  }
}
```

See [Building Custom MCP Servers](#building-custom-servers) below.

## Building Custom Servers

For Codex-specific workflows, you can create custom MCP servers:

### Use Cases
- Database migration management
- Test runner integration
- Build tool automation
- Custom code generation

### Resources
- [MCP Server SDK Documentation](https://modelcontextprotocol.io/docs/develop/build-server)
- [Official MCP Servers Repository](https://github.com/modelcontextprotocol/servers)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

### Example Structure

```
scripts/
├── mcp-server/
│   ├── index.ts
│   ├── tools/
│   │   ├── test-runner.ts
│   │   ├── db-migrate.ts
│   │   └── code-gen.ts
│   └── package.json
```

## Best Practices

### Development Workflow

1. **Start each session** by having Claude read relevant design docs
2. **Review approvals carefully** before confirming file modifications
3. **Use specific prompts** that reference file paths and requirements
4. **Test incrementally** after each AI-assisted change
5. **Commit frequently** to track AI-assisted changes separately

### Prompt Engineering for Codex

**Good prompts:**
- "Read the PDR in design/features/auth/pdr-phase-1.md and implement the login endpoint"
- "Create tests for packages/validation/src/user-schema.ts following the Testing.md guide"
- "Update AGENTS.md to reflect the changes in packages structure"

**Avoid:**
- "Fix everything" (too broad)
- "Make it better" (no specific guidance)
- Prompts without file paths or context

### Security Checklist

- [ ] Only include necessary project directories in filesystem access
- [ ] Never include directories with secrets or credentials
- [ ] Use read-only GitHub tokens when possible
- [ ] Review all file modifications before approval
- [ ] Regularly audit MCP server configuration
- [ ] Keep Claude Desktop updated

## Integration with Codex Workflow

### CI/CD Development

Use MCP to assist with CI/CD pipeline work:

1. Read workflow files: `.github/workflows/*.yml`
2. Test changes locally with act
3. Update documentation automatically
4. Create PRs with detailed descriptions

### Feature Implementation

Follow the Codex development process:

1. Read PDR and TTD documents
2. Review existing code structure
3. Implement features with AI assistance
4. Create tests following conventions
5. Update documentation

### Code Review

Enhance code review process:

1. Analyze PR diffs
2. Suggest improvements based on style guides
3. Check test coverage
4. Update related documentation

## Next Steps

- [Explore MCP Server Repository](https://github.com/modelcontextprotocol/servers)
- [Build Custom MCP Servers](https://modelcontextprotocol.io/docs/develop/build-server)
- [MCP Architecture Documentation](https://modelcontextprotocol.io/docs/learn/architecture)
- [Claude Desktop Documentation](https://claude.ai/desktop)

## Related Documentation

- [CI/CD Pipeline](./CI-CD-Pipeline.md) - Automated testing and deployment
- [Testing Guide](./Testing.md) - Testing strategy and frameworks
- [Code Structure](./CodeStructure.md) - Project organization
- [AGENTS.md](../../AGENTS.md) - AI agent development guidelines

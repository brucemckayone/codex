# Infrastructure Diagrams

This directory contains D2 diagrams for visualizing the Codex infrastructure.

## Diagrams

### 1. CI/CD Pipeline
- **Source**: [ci-cd-pipeline.d2](ci-cd-pipeline.d2)
- **Output**: [assets/ci-cd-pipeline.png](assets/ci-cd-pipeline.png)
- **Purpose**: Complete workflow from push to production - testing, preview, production flows, Neon branching strategy

### 2. Environment Management
- **Source**: [environment-management.d2](environment-management.d2)
- **Output**: [assets/environment-management.png](assets/environment-management.png)
- **Purpose**: Local → Preview → Production flow, database branching per environment, custom domains, secrets

### 3. Testing Strategy
- **Source**: [testing-strategy.d2](testing-strategy.d2)
- **Output**: [assets/testing-strategy.png](assets/testing-strategy.png)
- **Purpose**: Unit/integration/E2E test types, CI testing flow, ephemeral branches, test organization

### 4. Infrastructure Plan
- **Source**: [infraplan.d2](infraplan.d2)
- **Output**: [assets/infraplan.png](assets/infraplan.png)
- **Purpose**: Complete system architecture - Client → Cloudflare → Workers → Database → External services

### 5. Deployment Architecture
- **Source**: [deployment-architecture.d2](deployment-architecture.d2)
- **Output**: [assets/deployment-architecture.png](assets/deployment-architecture.png)
- **Purpose**: Detailed deployment architecture with all components and flows

## Building Diagrams

### Prerequisites

Install D2:

```bash
# macOS
brew install d2

# Linux
curl -fsSL https://d2lang.com/install.sh | sh -s --

# Or download from https://github.com/terrastruct/d2/releases
```

### Compile Diagrams

Compile a single diagram:

```bash
cd /Users/brucemckay/development/Codex/design/infrastructure/d2
d2 --theme=1 --sketch ci-cd-pipeline.d2 assets/ci-cd-pipeline.png
```

Compile all diagrams:

```bash
cd /Users/brucemckay/development/Codex/design/infrastructure/d2
d2 --theme=1 --sketch ci-cd-pipeline.d2 assets/ci-cd-pipeline.png
d2 --theme=1 --sketch environment-management.d2 assets/environment-management.png
d2 --theme=1 --sketch testing-strategy.d2 assets/testing-strategy.png
d2 --theme=1 --sketch infraplan.d2 assets/infraplan.png
d2 --theme=1 --sketch deployment-architecture.d2 assets/deployment-architecture.png
```

Compile with watch mode (auto-rebuild on changes):

```bash
d2 --theme=1 --sketch --watch ci-cd-pipeline.d2 assets/ci-cd-pipeline.png
```

### D2 Options

- `--theme=1` - Use sketch theme (hand-drawn style)
- `--sketch` - Enable sketch mode (hand-drawn appearance)
- `--watch` - Auto-rebuild on file changes
- `--layout=dagre` - Use dagre layout engine (default)
- `--layout=elk` - Use ELK layout engine (alternative)

## Theme

All infrastructure diagrams use theme 1 (sketch theme) for a hand-drawn, approachable appearance.

## Directory Structure

```
d2/
├── ci-cd-pipeline.d2              # CI/CD workflow
├── environment-management.d2      # Environment flow
├── testing-strategy.d2            # Testing patterns
├── infraplan.d2                   # System architecture
├── deployment-architecture.d2     # Deployment details
├── assets/                        # Compiled PNG outputs
│   ├── ci-cd-pipeline.png
│   ├── environment-management.png
│   ├── testing-strategy.png
│   ├── infraplan.png
│   └── deployment-architecture.png
└── README.md                      # This file
```

## Using Diagrams in Documentation

Reference diagrams using relative paths:

```markdown
<!-- From design/infrastructure/CICD.md -->
![CI/CD Pipeline](d2/assets/ci-cd-pipeline.png)

<!-- From design/infrastructure/README.md -->
![Infrastructure](d2/assets/infraplan.png)
```

## Editing Diagrams

### D2 Syntax Resources

- [D2 Language Docs](https://d2lang.com/)
- [D2 Playground](https://play.d2lang.com/)
- [D2 Examples](https://github.com/terrastruct/d2/tree/master/docs/examples)

### Common Patterns

**Containers (groups):**

```d2
container_name: {
  label: "Container Label"
  style.fill: "#E3F2FD"
  style.stroke: "#1976D2"

  child1: "Child 1"
  child2: "Child 2"
}
```

**Connections:**

```d2
source -> target: "Label" {
  style.stroke: "#FF0000"
  style.stroke-width: 2
}
```

**Shapes:**

```d2
service: "Service Name" {
  shape: rectangle  # or cylinder, cloud, circle, etc.
  style.fill: "#E0F2F1"
}
```

**Direction:**

```d2
direction: right  # or down, left, up
```

## Adding New Diagrams

1. Create new `.d2` file in this directory
2. Build your diagram using D2 syntax
3. Use color coding for clarity:
   - Testing: Blue (#E3F2FD, #1976D2)
   - Preview: Green (#C8E6C9, #4CAF50)
   - Production: Orange/Red (#FFEBEE, #F44336)
   - Database: Purple (#E1BEE7, #9C27B0)
   - Notes: Yellow (#FFF9C4, #F9A825)
4. Compile to `assets/<name>.png`
5. Document in this README
6. Reference in main documentation

Example:

```bash
# Create new diagram
vim monitoring.d2

# Compile
d2 --theme=1 --sketch monitoring.d2 assets/monitoring.png

# Use in markdown
![Monitoring](d2/assets/monitoring.png)
```

## Maintenance

### When Infrastructure Changes

1. Update the relevant `.d2` file(s)
2. Regenerate PNG(s)
3. Verify diagrams render correctly
4. Update documentation if paths changed

### Diagram Update Checklist

- [ ] Update D2 source file
- [ ] Regenerate PNG output
- [ ] Check PNG renders correctly (open in browser/viewer)
- [ ] Update documentation references if needed
- [ ] Commit both .d2 and .png files

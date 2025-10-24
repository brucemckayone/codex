# Infrastructure Diagrams

This directory contains D2 diagrams for visualizing the Codex infrastructure.

## Diagrams

### Architecture Overview

- **Source**: [architecture.d2](architecture.d2)
- **Output**: [assets/architecture.png](assets/architecture.png)
- **Purpose**: Shows the complete infrastructure stack with all services and connections

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
d2 architecture.d2 assets/architecture.png --theme=0 --pad=20
```

Compile with watch mode (auto-rebuild on changes):

```bash
d2 architecture.d2 assets/architecture.png --watch --theme=0 --pad=20
```

### D2 Options

- `--theme=0` - Use Neutral Default theme
- `--pad=20` - Add 20px padding around diagram
- `--watch` - Auto-rebuild on file changes
- `--layout=dagre` - Use dagre layout engine (default)
- `--layout=elk` - Use ELK layout engine (alternative)

## Theme

All infrastructure diagrams use the shared Codex theme defined in:

```
../../design /d2/theme.d2
```

The theme is imported using:

```d2
...@../../design /d2/theme
```

This provides consistent colors, styles, and variables across all diagrams.

## Directory Structure

```
d2/
├── architecture.d2       # Main infrastructure diagram
├── assets/               # Compiled PNG outputs
│   └── architecture.png
└── README.md            # This file
```

## Editing Diagrams

### D2 Syntax Resources

- [D2 Language Docs](https://d2lang.com/)
- [D2 Playground](https://play.d2lang.com/)
- [D2 Examples](https://github.com/terrastruct/d2/tree/master/docs/examples)

### Common Patterns

**Containers (groups):**

```d2
container_name: Container Label {
  style.stroke-dash: 3

  child1: Child 1
  child2: Child 2
}
```

**Connections:**

```d2
source -> target: Label {
  style.stroke: "#FF0000"
  style.stroke-width: 2
}
```

**Shapes:**

```d2
service: Service Name {
  shape: rectangle  # or cylinder, cloud, etc.
  style.fill: "#E0F2F1"
}
```

## Adding New Diagrams

1. Create new `.d2` file in this directory
2. Import the theme: `...@../../design /d2/theme`
3. Build your diagram using D2 syntax
4. Compile to `assets/<name>.png`
5. Reference in documentation

Example:

```bash
# Create new diagram
vim deployment.d2

# Compile
d2 deployment.d2 assets/deployment.png --theme=0 --pad=20

# Use in markdown
![Deployment](d2/assets/deployment.png)
```

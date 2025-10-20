# D2 Diagrams - Infrastructure Design

This directory contains D2 diagram source files for Codex infrastructure architecture.

## 🎨 Theme System

We use a custom theme with pastel colors for readability:

- **[theme.d2](theme.d2)** - Central theme file with all color variables
- Variables are imported using spread syntax: `...@theme`
- Easy to modify all diagrams by changing theme.d2

### Color Palette

**Containers:**
- Caddy: Soft green (#C8E6C9)
- Next.js: Light blue (#E1F5FE)
- Go Worker: Mint/teal (#E0F2F1)
- PostgreSQL: Lavender (#E8EAF6)
- Dragonfly: Light pink (#FFEBEE)
- Storage: Pale yellow (#FFF9C4)

**External Services:**
- Internet: Very light blue (#E3F2FD)
- Cloudflare R2: Peach (#FFE0B2)
- Stripe: Light purple (#E1BEE7)
- Email: Light coral (#FFCCBC)

## 📋 Diagrams

- **[phase1-infra-design.d2](phase1-infra-design.d2)** - Phase 1 MVP infrastructure

## 🔨 Building Diagrams

### Automatic Build (Recommended)

Compile all diagrams at once:

```bash
./build.sh
```

This will:
- Find all .d2 files in this directory
- Skip utility files (theme.d2, _*.d2)
- Compile to PNG in ../assets/
- Show progress with colored output

### Manual Build

Compile a specific diagram:

```bash
d2 --theme=200 --layout=elk phase1-infra-design.d2 ../assets/phase1-infra-design.png
```

### Build Options

- `--theme=200` - Dark Mauve theme (default)
- `--layout=elk` - ELK layout engine (better for complex diagrams)
- Other themes: Run `d2 themes` to see all options

### Watch Mode (Development)

Auto-rebuild on file changes:

```bash
d2 --theme=200 --layout=elk --watch phase1-infra-design.d2 ../assets/phase1-infra-design.png
```

## 📁 File Structure

```
d2/
├── README.md              # This file
├── build.sh              # Build script
├── theme.d2              # Theme variables (imported by diagrams)
└── phase1-infra-design.d2  # Phase 1 infrastructure

../assets/
└── phase1-infra-design.png  # Compiled output
```

## 🎯 Creating New Diagrams

1. Create a new .d2 file in this directory
2. Import the theme at the top:
   ```d2
   # Import theme variables
   ...@theme
   ```
3. Use theme variables for colors:
   ```d2
   mybox: {
     style: {
       fill: ${color-nextjs}
       stroke: ${stroke-nextjs}
     }
   }
   ```
4. Run `./build.sh` to compile

## 🎨 Customizing Colors

Edit [theme.d2](theme.d2) to change colors for all diagrams:

```d2
vars: {
  color-nextjs: "#E1F5FE"      # Change this
  stroke-nextjs: "#81D4FA"     # And this
  # ... all diagrams update automatically
}
```

Then rebuild: `./build.sh`

## 📚 D2 Resources

- **D2 Tour:** https://d2lang.com/tour/intro
- **Imports:** https://d2lang.com/tour/imports/
- **Themes:** https://d2lang.com/tour/themes/
- **Shapes:** https://d2lang.com/tour/shapes
- **Layouts:** https://d2lang.com/tour/layouts

## 🚀 Advanced Features

### Using Partials

Import specific parts of a diagram:

```d2
# Import only VPS container from another file
vps: @phase1-infra-design.vps
```

### Multiple Output Formats

```bash
# PNG (default)
d2 diagram.d2 output.png

# SVG (scalable)
d2 diagram.d2 output.svg

# PDF
d2 diagram.d2 output.pdf
```

### Dark Theme Support

```bash
d2 --theme=200 --dark-theme=201 diagram.d2 output.png
```

## 🛠️ Troubleshooting

**Error: d2 not found**
```bash
brew install d2
```

**Build script not executable**
```bash
chmod +x build.sh
```

**Import errors**
- Ensure theme.d2 exists in same directory
- Use relative imports without file extension: `...@theme` not `...@theme.d2`

**Color not working**
- Check variable name matches theme.d2
- Use `${variable-name}` syntax
- Variable names are case-sensitive

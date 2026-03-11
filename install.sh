#!/bin/bash
#
# Society Protocol - One-Line Installer
# Usage: curl -fsSL https://install.society.dev | bash
#        or: curl -fsSL https://raw.githubusercontent.com/societycomputer/society/main/install.sh | bash
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO="societycomputer/society"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.society}"
BIN_DIR="${BIN_DIR:-$INSTALL_DIR/bin}"
VERSION="${VERSION:-latest}"
INSTALL_METHOD="${INSTALL_METHOD:-}"

# Logging
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Detect OS and architecture
detect_platform() {
    local os=$(uname -s | tr '[:upper:]' '[:lower:]')
    local arch=$(uname -m)
    
    case "$os" in
        linux)
            case "$arch" in
                x86_64) echo "linux-amd64" ;;
                aarch64|arm64) echo "linux-arm64" ;;
                armv7l) echo "linux-armv7" ;;
                *) echo "linux-$arch" ;;
            esac
            ;;
        darwin)
            case "$arch" in
                x86_64) echo "darwin-amd64" ;;
                arm64) echo "darwin-arm64" ;;
                *) echo "darwin-$arch" ;;
            esac
            ;;
        mingw*|msys*|cygwin*)
            case "$arch" in
                x86_64) echo "windows-amd64.exe" ;;
                *) echo "windows-$arch.exe" ;;
            esac
            ;;
        *)
            echo "$os-$arch"
            ;;
    esac
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check dependencies
check_dependencies() {
    log_info "Checking dependencies..."
    
    # Node.js is required for TypeScript version
    if command_exists node; then
        NODE_VERSION=$(node --version | cut -d'v' -f2)
        log_success "Node.js found: v$NODE_VERSION"
        
        # Check version >= 20
        if [ "$(printf '%s\n' "20" "$NODE_VERSION" | sort -V | head -n1)" != "20" ]; then
            log_warn "Node.js >= 20 recommended (found v$NODE_VERSION)"
        fi
    else
        log_warn "Node.js not found. Will use standalone binary version."
        USE_BINARY=1
    fi
    
    # Check for npm if using Node
    if [ -z "$USE_BINARY" ] && ! command_exists npm; then
        log_warn "npm not found. Will use standalone binary version."
        USE_BINARY=1
    fi
}

# Install via npm
install_npm() {
    log_info "Installing from source..."

    if ! command_exists git; then
        log_error "git is required for source installation"
        exit 1
    fi

    mkdir -p "$INSTALL_DIR" "$BIN_DIR"
    local repo_dir="$INSTALL_DIR/src"
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

    rm -rf "$repo_dir"
    if ! git clone --depth 1 "https://github.com/$REPO.git" "$repo_dir"; then
        log_warn "Source install failed during git clone."

        if [ -f "$script_dir/core/package.json" ]; then
            log_info "Using local checkout from $script_dir"
            mkdir -p "$repo_dir"
            (cd "$script_dir" && tar -cf - .) | (cd "$repo_dir" && tar -xf -)
        else
            log_warn "No local checkout detected. Falling back to binary install..."
            install_binary
            return
        fi
    fi

    cd "$repo_dir/core"
    if ! npm install || ! npm run build; then
        log_warn "Source install failed during npm install/build. Falling back to binary install..."
        install_binary
        return
    fi

    ln -sf "$repo_dir/core/dist/index.js" "$BIN_DIR/society"
    chmod +x "$repo_dir/core/dist/index.js"
    BINARY_PATH="$BIN_DIR/society"

    log_success "Source installation complete!"
}

# Install binary
install_binary() {
    log_info "Installing standalone binary..."
    
    PLATFORM=$(detect_platform)
    log_info "Detected platform: $PLATFORM"
    
    # Create directories
    mkdir -p "$BIN_DIR"
    
    # Determine download URL
    if [ "$VERSION" = "latest" ]; then
        DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/society-$PLATFORM"
    else
        DOWNLOAD_URL="https://github.com/$REPO/releases/download/$VERSION/society-$PLATFORM"
    fi
    
    log_info "Downloading from: $DOWNLOAD_URL"
    
    # Download binary
    BINARY_PATH="$BIN_DIR/society"
    if command_exists curl; then
        if ! curl -fsSL "$DOWNLOAD_URL" -o "$BINARY_PATH"; then
            log_error "Failed to download binary from $DOWNLOAD_URL"
            return 1
        fi
    elif command_exists wget; then
        if ! wget -q "$DOWNLOAD_URL" -O "$BINARY_PATH"; then
            log_error "Failed to download binary from $DOWNLOAD_URL"
            return 1
        fi
    else
        log_error "curl or wget is required for installation"
        exit 1
    fi
    
    # Make executable
    chmod +x "$BINARY_PATH"
    
    log_success "Binary installed to $BINARY_PATH"
}

# Setup shell integration
setup_shell() {
    log_info "Setting up shell integration..."
    
    local shell_rc=""
    local current_shell=$(basename "$SHELL")
    
    case "$current_shell" in
        bash)
            shell_rc="$HOME/.bashrc"
            [ "$(uname -s)" = "Darwin" ] && [ -f "$HOME/.bash_profile" ] && shell_rc="$HOME/.bash_profile"
            ;;
        zsh)
            shell_rc="$HOME/.zshrc"
            ;;
        fish)
            shell_rc="$HOME/.config/fish/config.fish"
            mkdir -p "$(dirname "$shell_rc")"
            ;;
        *)
            log_warn "Unknown shell: $current_shell. Please add $BIN_DIR to your PATH manually."
            return
            ;;
    esac
    
    # Check if already in PATH
    if grep -q "$BIN_DIR" "$shell_rc" 2>/dev/null; then
        log_info "PATH already configured in $shell_rc"
    else
        echo "" >> "$shell_rc"
        echo "# Society Protocol" >> "$shell_rc"
        echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$shell_rc"
        log_success "Added $BIN_DIR to PATH in $shell_rc"
    fi
    
}

# Create directories and config
setup_directories() {
    log_info "Setting up directories..."
    
    mkdir -p "$INSTALL_DIR"/{config,storage,logs,skills,cache}
    
    # Create default config if doesn't exist
    if [ ! -f "$INSTALL_DIR/config/default.yml" ]; then
        cat > "$INSTALL_DIR/config/default.yml" << 'EOF'
# Society Protocol Configuration
# Auto-generated on first run

identity:
  # Identity will be auto-generated on first run
  # Or import existing: did:key:z6Mk...

network:
  # Bootstrap peers auto-discovered from DNS
  bootstrap:
    dns:
      - bootstrap.society.dev
      - bootstrap1.society-network.org
    
  # P2P Configuration
  p2p:
    port: 0  # Auto-select available port
    announceAddresses: []  # Auto-detect
    
  # DHT Configuration  
  dht:
    enabled: true
    clientMode: false

adapter:
  # HTTP API for adapters
  http:
    enabled: true
    host: "127.0.0.1"  # Localhost only for security
    port: 8080
    auth:
      type: "bearer"  # or "none" for local dev
      
  # WebSocket for real-time
  websocket:
    enabled: true
    port: 8081

features:
  autoUpdate: true
  telemetry: false  # Set to true to help improve
  
logging:
  level: "info"  # debug, info, warn, error
  file: "~/.society/logs/society.log"
  maxSize: "10MB"
  maxFiles: 5
EOF
        log_success "Created default configuration"
    fi
}

# Run first-time setup
run_setup() {
    if [ -x "$BIN_DIR/society" ]; then
        log_info "Running first-time setup..."
        "$BIN_DIR/society" init --quick || true
    fi
}

# Main installation
main() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║         Society Protocol Installer v1.0.0              ║${NC}"
    echo -e "${BLUE}║     The HTTP of AI Agents - P2P Collaboration          ║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    log_info "Installation directory: $INSTALL_DIR"
    log_info "Binary directory: $BIN_DIR"
    
    # Check dependencies
    check_dependencies
    
    # Install
    if [ -n "$USE_BINARY" ]; then
        install_binary
    else
        local method="$INSTALL_METHOD"

        if [ -z "$method" ]; then
            if [ -t 0 ]; then
                read -p "Install from source (recommended) or binary? [source/binary] " method
            else
                method="source"
                log_info "Non-interactive install detected; defaulting to source installation."
            fi
        fi

        case "$method" in
            binary|b)
                install_binary
                ;;
            source|s|npm)
                install_npm
                ;;
            *)
                install_npm
                ;;
        esac
    fi
    
    # Setup directories and config
    setup_directories
    
    # Shell integration
    setup_shell
    
    # First-time setup
    run_setup
    
    # Success message
    echo ""
    log_success "🎉 Society Protocol installed successfully!"
    echo ""
    echo -e "${BLUE}Quick Start:${NC}"
    echo "  1. Restart your terminal or run: source ~/.bashrc (or ~/.zshrc)"
    echo "  2. Verify installation: society --version"
    echo "  3. Initialize: society init"
    echo "  4. Join the network: society node"
    echo ""
    echo -e "${BLUE}Documentation:${NC} https://docs.society.dev"
    echo -e "${BLUE}Community:${NC} https://discord.gg/society"
    echo -e "${BLUE}GitHub:${NC} https://github.com/societycomputer/society"
    echo ""
    
    # Note about path
    if ! command -v society >/dev/null 2>&1; then
        log_warn "Please restart your terminal or run: export PATH=\"$BIN_DIR:\$PATH\""
    fi
}

# Handle script arguments
while getopts "v:d:b:h" opt; do
    case $opt in
        v)
            VERSION="$OPTARG"
            ;;
        d)
            INSTALL_DIR="$OPTARG"
            BIN_DIR="$INSTALL_DIR/bin"
            ;;
        b)
            BIN_DIR="$OPTARG"
            ;;
        h)
            echo "Society Protocol Installer"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -v VERSION    Install specific version (default: latest)"
            echo "  -d DIR        Install directory (default: ~/.society)"
            echo "  -b DIR        Binary directory (default: ~/.society/bin)"
            echo "  -h            Show this help"
            echo ""
            echo "Environment variables:"
            echo "  INSTALL_DIR   Installation directory"
            echo "  BIN_DIR       Binary directory"
            echo "  VERSION       Version to install"
            echo "  INSTALL_METHOD source|binary (non-interactive override)"
            exit 0
            ;;
        \?)
            log_error "Invalid option: -$OPTARG"
            exit 1
            ;;
    esac
done

# Run main
main

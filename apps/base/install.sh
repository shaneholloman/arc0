#!/bin/bash
set -e

REPO="amicalhq/arc0"
INSTALL_DIR="$HOME/.arc0/bin"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Cleanup function for failed installations
cleanup() {
  if [ -f "$INSTALL_DIR/arc0" ]; then
    rm -f "$INSTALL_DIR/arc0"
  fi
  if [ -f "$INSTALL_DIR/arc0.sha256" ]; then
    rm -f "$INSTALL_DIR/arc0.sha256"
  fi
}

# Set trap to cleanup on error
trap cleanup ERR

echo -e "${GREEN}Arc0 Installer${NC}"
echo ""

# Detect OS
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in
  darwin)
    OS_NAME="macOS"
    SHASUM_CMD="shasum -a 256"
    ;;
  linux)
    OS_NAME="Linux"
    SHASUM_CMD="sha256sum"
    ;;
  *)
    echo -e "${RED}Error: Unsupported operating system: $OS${NC}"
    echo "Arc0 currently supports macOS and Linux."
    exit 1
    ;;
esac

# Detect architecture
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)
    ARCH="x64"
    ARCH_NAME="x86_64"
    ;;
  aarch64|arm64)
    ARCH="arm64"
    ARCH_NAME="ARM64"
    ;;
  *)
    echo -e "${RED}Error: Unsupported architecture: $ARCH${NC}"
    echo "Arc0 currently supports x64 and ARM64 architectures."
    exit 1
    ;;
esac

echo -e "Detected: ${YELLOW}$OS_NAME ($ARCH_NAME)${NC}"
echo ""

BINARY="arc0-${OS}-${ARCH}"

# Get version (default to latest)
VERSION="${1:-latest}"
if [ "$VERSION" = "latest" ]; then
  echo "Fetching latest release..."
  DOWNLOAD_URL="https://github.com/$REPO/releases/latest/download/$BINARY"
  CHECKSUM_URL="https://github.com/$REPO/releases/latest/download/$BINARY.sha256"
else
  echo "Installing version: $VERSION"
  DOWNLOAD_URL="https://github.com/$REPO/releases/download/base-v$VERSION/$BINARY"
  CHECKSUM_URL="https://github.com/$REPO/releases/download/base-v$VERSION/$BINARY.sha256"
fi

# Create install directory
mkdir -p "$INSTALL_DIR"

# Download binary
echo "Downloading $BINARY..."
if ! curl -fsSL "$DOWNLOAD_URL" -o "$INSTALL_DIR/arc0"; then
  echo -e "${RED}Error: Failed to download binary.${NC}"
  echo "Please check if the version exists: https://github.com/$REPO/releases"
  exit 1
fi

# Download and verify checksum
echo "Verifying checksum..."
if ! curl -fsSL "$CHECKSUM_URL" -o "$INSTALL_DIR/arc0.sha256"; then
  echo -e "${RED}Error: Failed to download checksum file.${NC}"
  cleanup
  exit 1
fi

# Verify the checksum
cd "$INSTALL_DIR"
if ! $SHASUM_CMD -c arc0.sha256 > /dev/null 2>&1; then
  echo -e "${RED}Error: Checksum verification failed!${NC}"
  echo "The downloaded binary may be corrupted or tampered with."
  cleanup
  exit 1
fi

# Remove checksum file after verification
rm -f "$INSTALL_DIR/arc0.sha256"

# Make executable
chmod +x "$INSTALL_DIR/arc0"

echo ""
echo -e "${GREEN}Successfully installed arc0 to $INSTALL_DIR/arc0${NC}"
echo ""

# Verify installation
if "$INSTALL_DIR/arc0" --version > /dev/null 2>&1; then
  INSTALLED_VERSION=$("$INSTALL_DIR/arc0" --version 2>&1)
  echo -e "Installed: ${YELLOW}$INSTALLED_VERSION${NC}"
  echo ""
fi

# Configure shell PATH
configure_shell() {
  local shell_name=$(basename "$SHELL")
  local config_file=""
  local path_entry=""

  case "$shell_name" in
    zsh)
      config_file="$HOME/.zshrc"
      path_entry='export PATH="$HOME/.arc0/bin:$PATH"'
      ;;
    bash)
      # Check for .bashrc first, then .bash_profile
      if [ -f "$HOME/.bashrc" ]; then
        config_file="$HOME/.bashrc"
      elif [ -f "$HOME/.bash_profile" ]; then
        config_file="$HOME/.bash_profile"
      else
        config_file="$HOME/.bashrc"
      fi
      path_entry='export PATH="$HOME/.arc0/bin:$PATH"'
      ;;
    fish)
      config_file="$HOME/.config/fish/config.fish"
      path_entry='set -gx PATH $HOME/.arc0/bin $PATH'
      mkdir -p "$(dirname "$config_file")"
      ;;
    *)
      echo -e "${YELLOW}Unknown shell: $shell_name${NC}"
      echo "Add this to your shell profile manually:"
      echo '  export PATH="$HOME/.arc0/bin:$PATH"'
      return
      ;;
  esac

  # Check if already configured
  if [ -f "$config_file" ] && grep -q '\.arc0/bin' "$config_file"; then
    echo -e "PATH already configured in ${YELLOW}$config_file${NC}"
  else
    # Add to config file
    echo "" >> "$config_file"
    echo "# Arc0 CLI" >> "$config_file"
    echo "$path_entry" >> "$config_file"
    echo -e "Updated ${YELLOW}$config_file${NC}"
  fi
}

configure_shell

echo ""
echo -e "${GREEN}arc0 is ready to use!${NC}"
echo ""
echo "Restart your terminal or run:"
echo "  exec \$SHELL"
echo ""
echo "Then run 'arc0' to get started."

#!/usr/bin/env bash
# Prints Casks/mdviewer.rb for lambda-house/homebrew-tap.
#
#   cask.sh <version> <sha256 of the aarch64 dmg> <sha256 of the x64 dmg>
set -euo pipefail
version=$1 sha_arm=$2 sha_intel=$3

cat <<EOF
cask "mdviewer" do
  arch arm: "aarch64", intel: "x64"

  version "$version"
  sha256 arm:   "$sha_arm",
         intel: "$sha_intel"

  url "https://github.com/lambda-house/mdviewer-mj/releases/download/v#{version}/MDViewer_#{version}_#{arch}.dmg"
  name "MDViewer"
  desc "Markdown viewer with Mermaid diagrams and an agent workspace"
  homepage "https://github.com/lambda-house/mdviewer-mj"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on :macos

  app "MDViewer.app"

  zap trash: [
    "~/Library/Application Support/cc.lambdahouse.mdviewer",
    "~/Library/Application Support/mdviewer",
    "~/Library/Caches/cc.lambdahouse.mdviewer",
    "~/Library/Preferences/cc.lambdahouse.mdviewer.plist",
    "~/Library/Saved Application State/cc.lambdahouse.mdviewer.savedState",
    "~/Library/WebKit/cc.lambdahouse.mdviewer",
  ]

  caveats <<~EOS
    MDViewer is not notarized yet. If macOS refuses to open it, allow it in
    System Settings → Privacy & Security → "Open Anyway", or run:
      xattr -dr com.apple.quarantine "#{appdir}/MDViewer.app"
  EOS
end
EOF

#!/usr/bin/env bash
# Prints the PKGBUILD of the AUR package mdviewer-bin, which repackages the
# release .deb. .SRCINFO is generated from it with `makepkg --printsrcinfo`.
#
#   PKGBUILD.sh <version> <sha256 of the amd64 .deb> <sha256 of LICENSE>
set -euo pipefail
version=$1 sha_deb=$2 sha_license=$3

cat <<EOF
# Maintainer: Lambda House <https://github.com/lambda-house/mdviewer-mj>
pkgname=mdviewer-bin
pkgver=$version
pkgrel=1
pkgdesc='Markdown viewer with Mermaid diagrams, syntax highlighting and an agent workspace'
arch=('x86_64')
url='https://github.com/lambda-house/mdviewer-mj'
license=('MIT')
depends=('cairo' 'dbus' 'gdk-pixbuf2' 'glib2' 'glibc' 'gtk3' 'hicolor-icon-theme' 'libgcc' 'libsoup3' 'webkit2gtk-4.1')
provides=('mdviewer')
conflicts=('mdviewer')
source=("MDViewer_\${pkgver}_amd64.deb::\$url/releases/download/v\${pkgver}/MDViewer_\${pkgver}_amd64.deb"
        "LICENSE-\${pkgver}::https://raw.githubusercontent.com/lambda-house/mdviewer-mj/v\${pkgver}/LICENSE")
sha256sums=('$sha_deb'
            '$sha_license')

package() {
  bsdtar -xf data.tar.gz -C "\$pkgdir"
  install -Dm644 "LICENSE-\${pkgver}" "\$pkgdir/usr/share/licenses/\$pkgname/LICENSE"
}
EOF

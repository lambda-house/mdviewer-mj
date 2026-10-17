#!/usr/bin/env bash
# Adds the .deb and .rpm packages in <incoming> to the apt and dnf repository
# in <site> (the lambda-house/mdviewer-packages Pages site) and signs it.
#
#   GPG_KEY_ID=<fingerprint> build.sh <site> <incoming>
#
# The signing key must already be in the gpg keyring, without a passphrase.
# Needs dpkg-dev, apt-utils, createrepo-c, rpm and gnupg (Debian/Ubuntu names).
set -euo pipefail

site=$(realpath "$1")
incoming=$(realpath "$2")
key=${GPG_KEY_ID:?set GPG_KEY_ID to the signing key fingerprint}

mkdir -p "$site/deb/pool/main" "$site/rpm/x86_64"
touch "$site/.nojekyll"

gpg --armor --export "$key" > "$site/mdviewer.asc"
gpg --export "$key" > "$site/mdviewer.gpg"

# dnf: signed packages plus signed metadata (gpgcheck and repo_gpgcheck)
for rpm in "$incoming"/*.rpm; do
  cp "$rpm" "$site/rpm/x86_64/"
  rpmsign --addsign \
    --define "__gpg $(command -v gpg)" \
    --define "_gpg_name $key" \
    --define "_gpg_sign_cmd_extra_args --batch --pinentry-mode loopback" \
    "$site/rpm/x86_64/$(basename "$rpm")"
done
createrepo_c --quiet --update "$site/rpm"
gpg --batch --yes --local-user "$key" --armor --detach-sign \
  --output "$site/rpm/repodata/repomd.xml.asc" "$site/rpm/repodata/repomd.xml"
cat > "$site/mdviewer.repo" <<'EOF'
[mdviewer]
name=MDViewer
baseurl=https://lambda-house.github.io/mdviewer-packages/rpm
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=https://lambda-house.github.io/mdviewer-packages/mdviewer.asc
EOF

# apt: one "stable" suite; apt verifies InRelease against mdviewer.gpg
cp "$incoming"/*.deb "$site/deb/pool/main/"
cd "$site/deb"
binary=dists/stable/main/binary-amd64
mkdir -p "$binary"
apt-ftparchive packages pool > "$binary/Packages"
gzip -9nkf "$binary/Packages"
rm -f dists/stable/Release dists/stable/InRelease dists/stable/Release.gpg
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin=MDViewer \
  -o APT::FTPArchive::Release::Label=MDViewer \
  -o APT::FTPArchive::Release::Suite=stable \
  -o APT::FTPArchive::Release::Codename=stable \
  -o APT::FTPArchive::Release::Architectures=amd64 \
  -o APT::FTPArchive::Release::Components=main \
  release dists/stable > /tmp/Release
mv /tmp/Release dists/stable/Release
gpg --batch --yes --local-user "$key" --clearsign \
  --output dists/stable/InRelease dists/stable/Release
gpg --batch --yes --local-user "$key" --armor --detach-sign \
  --output dists/stable/Release.gpg dists/stable/Release

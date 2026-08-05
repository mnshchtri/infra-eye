# AUR packaging

`infraeye-bin/` is the source of truth for the [AUR](https://aur.archlinux.org)
package. The AUR itself is a separate git repository — this directory is where
the files are kept under version control alongside the app, and its contents get
copied into the AUR repo when publishing.

`infraeye-bin` repackages the prebuilt `InfraEye-Linux.deb` from each
`desktop-v*` GitHub release. The `.deb` is used rather than the
`.pkg.tar.zst` published beside it because it is the only release asset that
carries the full install layout (binary, `.desktop` entry, icon) without already
being a built pacman package.

Once published, Arch users install it with any AUR helper:

```bash
yay -S infraeye-bin
```

## First-time publish

Requires an [AUR account](https://aur.archlinux.org/register) with an SSH public
key registered under *My Account → SSH Public Key*. The AUR authenticates by key
only — there is no password auth for git.

```bash
git clone ssh://aur@aur.archlinux.org/infraeye-bin.git /tmp/aur-infraeye-bin
cp packaging/aur/infraeye-bin/{PKGBUILD,.SRCINFO} /tmp/aur-infraeye-bin/
cd /tmp/aur-infraeye-bin
git add PKGBUILD .SRCINFO
git commit -m "Initial import: infraeye-bin 1.6.1-1"
git push origin master
```

Cloning an unregistered package name returns an empty repository — that is
expected, and the first push is what creates it.

## Updating for a new release

`pkgver` and `sha256sums` both have to change, and `.SRCINFO` must be regenerated
or the AUR will reject the push as out of sync with the PKGBUILD.

```bash
# from packaging/aur/infraeye-bin
curl -sL -o /tmp/InfraEye-Linux.deb \
  https://github.com/mnshchtri/infra-eye/releases/download/desktop-v<VERSION>/InfraEye-Linux.deb
sha256sum /tmp/InfraEye-Linux.deb
# edit PKGBUILD: set pkgver=<VERSION>, reset pkgrel=1, paste the new sha256sums
makepkg --printsrcinfo > .SRCINFO
```

Then copy both files into the AUR clone and push as above.

`pkgrel` only increments when the packaging changes for an unchanged upstream
version; it resets to `1` on every new `pkgver`.

## Testing changes

macOS/arm64 hosts can build and check the package in a container — this is how
the current PKGBUILD was validated:

```bash
docker run --rm --platform linux/amd64 --security-opt seccomp=unconfined \
  -v "$PWD/packaging/aur/infraeye-bin:/pkg" archlinux:base-devel bash -c '
    pacman -Syu --noconfirm --needed --disable-sandbox namcap gtk3 webkit2gtk-4.1 hicolor-icon-theme
    useradd -m builder && cp /pkg/PKGBUILD /home/builder/ && chown -R builder /home/builder
    su builder -c "cd /home/builder && makepkg -f --noconfirm"
    su builder -c "namcap /home/builder/*.pkg.tar.zst"
  '
```

`--disable-sandbox` and `seccomp=unconfined` are needed only because pacman's
sandbox does not work under QEMU emulation on an Apple Silicon host; neither is
required on a real x86_64 Arch machine.

### Known namcap findings

- **`Uncommon license identifiers such as 'MIT' require license files`** — the
  repository has no `LICENSE` file, even though the README advertises MIT, so
  there is nothing to install into `/usr/share/licenses/infraeye-bin/`. Adding
  `LICENSE` upstream and shipping it in the release artifacts clears this.
- **executable stack / lacks PIE / lacks FULL RELRO** — properties of the
  upstream Go binary rather than the packaging; they can only be changed by how
  the release binary is linked.

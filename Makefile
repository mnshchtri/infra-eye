.PHONY: dev infra backend frontend migrate build clean desktop-build desktop-package desktop-stamp-version

# Start core infrastructure in Docker (DB, Redis)
# This uses official pre-built images, avoiding DNS/build issues
infra:
	docker compose up postgres redis -d

# Stop infrastructure
infra-down:
	docker compose down

# Run backend dev server
backend:
	cd backend && go run ./cmd/server/main.go

# Run frontend dev server
frontend:
	cd frontend && npm run dev

# Run everything natively (DB in docker, App locally)
# Requires Go and Node.js
dev-local:
	@echo "🚀 Starting InfraEye Local Stack..."
	@make infra
	@echo "⏳ Waiting for databases to be ready..."
	@sleep 5
	@(cd backend && go run ./cmd/server/main.go &) && (cd frontend && npm run dev)

# Legacy dev command (tries to start app in Docker too)
dev:
	@echo "🚀 Starting InfraEye Full Stack (Local Backend & Frontend)..."
	@./dev.sh

# Install frontend deps
frontend-install:
	cd frontend && npm install

# Install backend deps
backend-install:
	cd backend && go mod tidy

# Build production binaries
build:
	cd backend && go build -o ./bin/server ./cmd/server/main.go
	cd frontend && npm run build

# Build the standalone desktop app (Wails). Requires `wails` CLI on PATH.
# On macOS, force the classic linker — newer Xcode's default linker rejects
# some Go-produced object files (a go-m1cpu link crash), reproduced both
# locally and in CI. Not applicable/needed on Linux.
desktop-build:
	cd frontend && VITE_API_URL=http://127.0.0.1:8073 VITE_DESKTOP=true npm run build
	rm -rf backend/cmd/desktop/frontenddist
	mkdir -p backend/cmd/desktop/frontenddist
	cp -R frontend/dist/. backend/cmd/desktop/frontenddist/
	@$(MAKE) desktop-stamp-version
	@APP_VERSION=$$(node -p "require('./frontend/package.json').version"); \
	cd backend/cmd/desktop && \
		if [ "$$(uname)" = "Darwin" ]; then \
			CGO_LDFLAGS=-Wl,-ld_classic wails build -ldflags "-X main.appVersion=$$APP_VERSION"; \
		else \
			wails build -ldflags "-X main.appVersion=$$APP_VERSION"; \
		fi
	@$(MAKE) desktop-package

# Wails templates wails.json's info.productVersion into the bundle's
# CFBundleShortVersionString / CFBundleVersion — it is not affected by the
# -X main.appVersion ldflag, which only sets what the app reports about itself.
# .github/workflows/desktop-release.yml stamps it from the release tag, so
# released bundles are correct; a local `make desktop-build` had nothing doing
# the same and produced a bundle whose Finder version disagreed with the app's.
# package.json is already the source of truth for the ldflag and for the .deb
# version in desktop-package, so take it from there too. Rewrites the file only
# when the value actually differs, keeping a normal build a no-op on the tree.
desktop-stamp-version:
	@APP_VERSION=$$(node -p "require('./frontend/package.json').version"); \
	node -e 'const fs=require("fs"),p="backend/cmd/desktop/wails.json",c=JSON.parse(fs.readFileSync(p,"utf8"));if(c.info.productVersion===process.argv[1]){process.exit(0)}c.info.productVersion=process.argv[1];fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n");console.log("wails.json info.productVersion -> "+process.argv[1])' "$$APP_VERSION"

# hdiutil, left to auto-size from -srcfolder, sizes the intermediate image off
# the source's raw byte count, which undercounts a codesigned .app's extended
# attributes — so it fails with "No space left on device" on a disk with tens of
# GB free once the app is big enough. desktop-release.yml already sizes
# explicitly off `du` plus headroom for this reason; this recipe had not caught
# up, and now fails locally at ~90MB. Same fix here so the two agree.
#
# Wrap the raw `wails build` output (an unpacked .app on macOS, a bare ELF
# binary on Linux) into the same installer format the GitHub release uses —
# a double-clickable .dmg on macOS, a proper .deb on Linux — instead of
# leaving people to run something out of build/bin/ directly. Mirrors
# .github/workflows/desktop-release.yml's packaging steps.
desktop-package:
	@APP_VERSION=$$(node -p "require('./frontend/package.json').version"); \
	if [ "$$(uname)" = "Darwin" ]; then \
		cd backend/cmd/desktop/build/bin && \
		rm -rf dmg-staging InfraEye.dmg && \
		mkdir dmg-staging && \
		cp -R InfraEye.app dmg-staging/ && \
		ln -s /Applications dmg-staging/Applications && \
		STAGING_MB=$$(du -sm dmg-staging | cut -f1) && \
		hdiutil create -volname "InfraEye" -srcfolder dmg-staging -ov -format UDZO -size "$$((STAGING_MB + 200))m" InfraEye.dmg && \
		rm -rf dmg-staging && \
		echo "Installer ready: backend/cmd/desktop/build/bin/InfraEye.dmg (double-click to mount, then drag InfraEye to Applications)"; \
	else \
		PKGROOT=backend/cmd/desktop/build/bin/pkgroot; \
		rm -rf "$$PKGROOT"; \
		mkdir -p "$$PKGROOT/DEBIAN" "$$PKGROOT/usr/bin" "$$PKGROOT/usr/share/applications" "$$PKGROOT/usr/share/icons/hicolor/1024x1024/apps"; \
		cp backend/cmd/desktop/build/bin/infraeye-desktop "$$PKGROOT/usr/bin/infraeye-desktop"; \
		chmod 0755 "$$PKGROOT/usr/bin/infraeye-desktop"; \
		cp backend/cmd/desktop/build/appicon.png "$$PKGROOT/usr/share/icons/hicolor/1024x1024/apps/infraeye.png"; \
		printf '%s\n' \
			'[Desktop Entry]' \
			'Name=InfraEye' \
			'Comment=Agentless observability platform' \
			'Exec=/usr/bin/infraeye-desktop' \
			'Icon=infraeye' \
			'Terminal=false' \
			'Type=Application' \
			'Categories=Utility;Development;' \
			> "$$PKGROOT/usr/share/applications/infraeye.desktop"; \
		printf '%s\n' \
			'Package: infra-eye' \
			"Version: $$APP_VERSION" \
			'Section: utils' \
			'Priority: optional' \
			'Architecture: amd64' \
			'Depends: libgtk-3-0, libwebkit2gtk-4.1-0' \
			'Maintainer: InfraEye <noreply@infraeye.local>' \
			'Description: Agentless observability platform — desktop app' \
			' A fully self-contained native app for managing Linux servers and' \
			' Kubernetes clusters. SQLite-backed, no Docker or Postgres required.' \
			> "$$PKGROOT/DEBIAN/control"; \
		dpkg-deb --build --root-owner-group "$$PKGROOT" backend/cmd/desktop/build/bin/InfraEye.deb; \
		rm -rf "$$PKGROOT"; \
		echo "Installer ready: backend/cmd/desktop/build/bin/InfraEye.deb (install with: sudo dpkg -i InfraEye.deb)"; \
	fi

# Clean build artifacts
clean:
	rm -rf backend/bin
	rm -rf frontend/dist

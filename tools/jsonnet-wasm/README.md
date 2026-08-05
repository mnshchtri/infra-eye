# jsonnet-wasm

Compiles [go-jsonnet](https://github.com/google/go-jsonnet) to WebAssembly so the
**Jsonnet Evaluator (Tanka)** tool on InfraEye's Developer Tools page
(`frontend/src/pages/DevTools.tsx`) can evaluate Jsonnet — the language
[Tanka](https://grafana.com/oss/tanka/) uses for Kubernetes config — entirely
client-side, no backend round-trip.

## Rebuilding

Only needed when `main.go` changes or go-jsonnet is upgraded; the built
`jsonnet.wasm` is committed to `frontend/public/wasm/` and does not need to be
rebuilt for normal frontend/backend work.

```bash
cd tools/jsonnet-wasm
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o jsonnet.wasm main.go
cp jsonnet.wasm ../../frontend/public/wasm/jsonnet.wasm
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" ../../frontend/public/wasm/wasm_exec.js
```

`wasm_exec.js` is Go's WASM runtime glue — it must come from the same Go
version used to build `jsonnet.wasm` (the two are version-coupled).

// Command jsonnet-wasm compiles the go-jsonnet evaluator to WebAssembly so
// InfraEye's Developer Tools page can evaluate Jsonnet (the language Tanka
// [https://grafana.com/oss/tanka/] uses for Kubernetes config) entirely in
// the browser, with no backend round-trip.
//
// Build with:
//
//	GOOS=js GOARCH=wasm go build -o jsonnet.wasm main.go
//
// Exposes a single global, `jsonnetEvaluate(snippet string) -> {output, error}`,
// called from frontend/src/utils/jsonnetEvaluator.ts.
package main

import (
	"syscall/js"

	"github.com/google/go-jsonnet"
)

func evaluate(this js.Value, args []js.Value) any {
	result := js.Global().Get("Object").New()
	if len(args) < 1 {
		result.Set("output", "")
		result.Set("error", "missing snippet argument")
		return result
	}

	snippet := args[0].String()
	vm := jsonnet.MakeVM()
	out, err := vm.EvaluateAnonymousSnippet("input.jsonnet", snippet)
	if err != nil {
		result.Set("output", "")
		result.Set("error", err.Error())
		return result
	}

	result.Set("output", out)
	result.Set("error", js.Null())
	return result
}

func main() {
	js.Global().Set("jsonnetEvaluate", js.FuncOf(evaluate))
	select {} // keep the wasm instance alive so the exported func stays callable
}

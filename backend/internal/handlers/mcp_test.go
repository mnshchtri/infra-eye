package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCheckMCPServerAcceptsJSONRPCMCPResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{},"serverInfo":{"name":"kubernetes-mcp-server","version":"1.0.0"}}}`))
	}))
	defer server.Close()

	available, statusCode, details := checkMCPServer(server.URL)
	if !available {
		t.Fatalf("expected MCP server to be available, got details=%q", details)
	}
	if statusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", statusCode)
	}
}

func TestCheckMCPServerRejectsUnrelatedHTTPService(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("<html>not kubernetes-mcp-server</html>"))
	}))
	defer server.Close()

	available, _, _ := checkMCPServer(server.URL)
	if available {
		t.Fatal("expected an unrelated HTTP service to be reported unavailable")
	}
}

func TestCheckMCPServerRejectsHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	available, statusCode, _ := checkMCPServer(server.URL)
	if available {
		t.Fatal("expected a 500 response to be reported unavailable")
	}
	if statusCode != http.StatusInternalServerError {
		t.Fatalf("expected status 500, got %d", statusCode)
	}
}

func TestCheckMCPServerReportsUnreachable(t *testing.T) {
	available, _, details := checkMCPServer("http://127.0.0.1:1")
	if available {
		t.Fatal("expected unreachable endpoint to be reported unavailable")
	}
	if details == "" {
		t.Fatal("expected an unreachable endpoint to include details")
	}
}

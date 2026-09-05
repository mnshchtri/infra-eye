package audit

import (
	"bytes"
	"fmt"
)

// ScanLog receives one human-readable progress line as a scan runs, for
// streaming a live console to the UI (see handlers/codeaudit.go, which wires
// this to a WebSocket room) — the same "watch it happen" feedback Jenkins
// gives a running build, instead of a spinner that says nothing for however
// long CodeQL or a Docker-run ZAP scan takes. nil is valid and every call
// site goes through logf, which no-ops on a nil receiver, so RunCodeScan and
// RunDastScan work exactly as before when nobody's watching.
type ScanLog func(line string)

func (l ScanLog) Logf(format string, args ...any) {
	if l == nil {
		return
	}
	l(fmt.Sprintf(format, args...))
}

// lineTee writes into buf (the full output, for parsing once the process
// exits) while also invoking onLine for each complete line as it arrives —
// letting a caller stream a subprocess's real output live without losing
// the ability to parse it as a whole afterward. A partial trailing line (no
// trailing '\n' yet) is held back until either more data completes it or
// Flush is called at process exit.
type lineTee struct {
	buf     *bytes.Buffer
	onLine  ScanLog
	partial []byte
}

func (t *lineTee) Write(p []byte) (int, error) {
	t.buf.Write(p)
	if t.onLine != nil {
		t.partial = append(t.partial, p...)
		for {
			idx := bytes.IndexByte(t.partial, '\n')
			if idx < 0 {
				break
			}
			line := bytes.TrimRight(t.partial[:idx], "\r")
			if len(line) > 0 {
				t.onLine(string(line))
			}
			t.partial = t.partial[idx+1:]
		}
	}
	return len(p), nil
}

// Flush emits whatever partial line never got a trailing newline (many CLI
// progress bars end this way) so the console doesn't silently swallow it.
func (t *lineTee) Flush() {
	if t.onLine != nil && len(t.partial) > 0 {
		t.onLine(string(bytes.TrimRight(t.partial, "\r")))
		t.partial = nil
	}
}

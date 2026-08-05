//go:build windows

package updater

import (
	"fmt"
	"syscall"
	"unsafe"
)

// Apply downloads the NSIS installer .exe and launches it elevated (the
// "runas" ShellExecute verb, which triggers the standard Windows UAC
// prompt — unavoidable for anything that writes to Program Files). The
// installer runs silently (/S) and, per the Wails NSIS template, relaunches
// the app itself once done — so there's no relaunchPath for the caller to
// spawn here, just a delay before this process quits so the installer can
// replace its executable.
func Apply(downloadURL string) (relaunchPath string, err error) {
	exePath, cleanup, err := download(downloadURL, "infraeye-update-*.exe")
	if err != nil {
		return "", err
	}
	_ = cleanup // deliberately not called — the installer needs the file to still exist when it runs

	if err := shellExecuteRunAs(exePath, "/S"); err != nil {
		return "", fmt.Errorf("launch installer elevated: %w", err)
	}

	return "", nil
}

// shellExecuteRunAs calls the Win32 ShellExecuteW API with the "runas" verb
// to request UAC elevation — there's no way to do this through os/exec,
// which always runs at the caller's current privilege level.
func shellExecuteRunAs(path, args string) error {
	verb, err := syscall.UTF16PtrFromString("runas")
	if err != nil {
		return err
	}
	file, err := syscall.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	params, err := syscall.UTF16PtrFromString(args)
	if err != nil {
		return err
	}

	shell32 := syscall.NewLazyDLL("shell32.dll")
	shellExecuteW := shell32.NewProc("ShellExecuteW")

	const swShowNormal = 1
	ret, _, callErr := shellExecuteW.Call(
		0,
		uintptr(unsafe.Pointer(verb)),
		uintptr(unsafe.Pointer(file)),
		uintptr(unsafe.Pointer(params)),
		0,
		swShowNormal,
	)
	// ShellExecute returns a value >32 on success (it's a legacy HINSTANCE,
	// not a real handle — this threshold is the documented success check).
	if ret <= 32 {
		if callErr != nil && callErr != syscall.Errno(0) {
			return fmt.Errorf("ShellExecute failed (code %d): %w", ret, callErr)
		}
		return fmt.Errorf("ShellExecute failed with code %d", ret)
	}
	return nil
}

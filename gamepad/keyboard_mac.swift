// macOS keyboard helper for wltoys-drive.
//
// WHY THIS EXISTS: mpv hands its Lua bindings only the most-recently-pressed key,
// so through the mpv keyboard path throttle + steer can't combine (press D while
// holding W and W is dropped — car stops, wheels turn). This helper reads the
// PHYSICAL keyboard directly via a listen-only CGEventTap, which reports every
// key independently regardless of which app is focused, and emits the SAME
// "KEYS ..." heartbeat lines the mpv Lua used to — but with the FULL held set.
// drive.mjs feeds each line to handleKeyLine unchanged, so keys now mix.
//
//   stdout:  "KEYS w d\n"  held set, 20 Hz   |  "KEYS -\n" none
//            "HUD\n" on 'h' down             |  "REC\n" on 'r' down
//   --probe: print OK/DENIED (Input Monitoring granted?) then exit 0/1.
//
// PERMISSION: a listen-only key tap needs the "Input Monitoring" TCC grant
// (System Settings > Privacy & Security > Input Monitoring). It attaches to the
// app that launched the process (your Terminal), not this binary. --probe (and
// first real run) calls CGRequestListenEventAccess() so the app shows up there.
//
// Build: see gamepad/build-mac.sh (swiftc, CoreGraphics + Foundation, no plist).

import CoreGraphics
import Foundation
import AppKit  // NSWorkspace — only drive while the video window is frontmost

// ANSI virtual keycodes (position-based, layout-independent for these) -> the key
// names handleKeyLine already parses. 'h' is handled separately as the HUD toggle.
let STEER_KEYS: [Int64: String] = [
    13: "w", 0: "a", 1: "s", 2: "d",
    126: "UP", 125: "DOWN", 123: "LEFT", 124: "RIGHT", 49: "SPACE",
]
let HUD_KEY: Int64 = 4  // 'h'
let REC_KEY: Int64 = 15 // 'r' — recording toggle, so a keyboard-only Mac can record
                        // (Y is a GAMEPAD button and does nothing on a keyboard)

let outFH = FileHandle.standardOutput
func line(_ s: String) { outFH.write((s + "\n").data(using: .utf8)!) } // unbuffered; one write per line
func note(_ s: String) { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }

// --probe: let drive.mjs decide helper-vs-fallback without spinning up a tap. Also
// requests access when missing, so the app lands in the Input Monitoring list.
if CommandLine.arguments.contains("--probe") {
    let ok = CGPreflightListenEventAccess()
    if !ok { CGRequestListenEventAccess() } // surface the prompt / add to the list
    print(ok ? "OK" : "DENIED")
    exit(ok ? 0 : 1)
}

if !CGPreflightListenEventAccess() {
    CGRequestListenEventAccess() // trigger the system prompt (won't be granted this run)
    note("keyboard_mac: needs Input Monitoring. Grant it in System Settings > Privacy & Security > Input Monitoring (add your terminal), then relaunch.")
    exit(1)
}

// Held-key state, mutated only from the run-loop thread (tap callback + timer).
var held = Set<String>()
var hudDown = false
var recDown = false
var focused = false   // set each tick: is the video window frontmost? gates all output
var lastFrontmost = ""
// Only steer the car while the video window is focused — a global key tap would
// otherwise drive the car from keystrokes typed into OTHER apps. Matched by the
// frontmost app's name / bundle id (default "mpv"), overridable via KB_FOCUS_MATCH.
let focusMatch = (ProcessInfo.processInfo.environment["KB_FOCUS_MATCH"] ?? "mpv").lowercased()

// Listen-only tap: sees real per-key keyDown/keyUp (multiple keys down at once),
// never consumes the event (so the keys still reach whatever app is focused).
let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)
guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
    eventsOfInterest: CGEventMask(mask),
    callback: { _, type, event, _ in
        let kc = event.getIntegerValueField(.keyboardEventKeycode)
        if type == .keyDown {
            if let name = STEER_KEYS[kc] { held.insert(name) }
            else if kc == HUD_KEY, !hudDown { hudDown = true; if focused { line("HUD") } } // one-shot; only when focused
            else if kc == REC_KEY, !recDown { recDown = true; if focused { line("REC") } } // ditto
        } else if type == .keyUp {
            if let name = STEER_KEYS[kc] { held.remove(name) }
            else if kc == HUD_KEY { hudDown = false }
            else if kc == REC_KEY { recDown = false }
        }
        return Unmanaged.passUnretained(event)
    }, userInfo: nil)
else {
    note("keyboard_mac: could not create the event tap (Input Monitoring not granted?).")
    exit(1)
}

let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), src, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)

// 20 Hz idempotent heartbeat — emit the FULL held set every 50 ms, matching the
// mpv Lua's old cadence so drive.mjs's stale-heartbeat failsafe behaves the same.
let timer = CFRunLoopTimerCreateWithHandler(kCFAllocatorDefault, CFAbsoluteTimeGetCurrent(), 0.05, 0, 0) { _ in
    if !CGEvent.tapIsEnabled(tap: tap) { CGEvent.tapEnable(tap: tap, enable: true) } // recover if the system disabled it
    // Focus gate: only feed the car when the video window is frontmost, so keystrokes
    // typed into other apps never move it.
    let app = NSWorkspace.shared.frontmostApplication
    let name = (app?.localizedName ?? "").lowercased()
    let bid = (app?.bundleIdentifier ?? "").lowercased()
    focused = name.contains(focusMatch) || bid.contains(focusMatch)
    let display = app?.localizedName ?? "?"
    if display != lastFrontmost { lastFrontmost = display; note("focus: \(display) — \(focused ? "DRIVE" : "ignore")") }
    let ks = focused ? held.sorted().joined(separator: " ") : "" // neutral while another app is focused
    line("KEYS " + (ks.isEmpty ? "-" : ks))
}
CFRunLoopAddTimer(CFRunLoopGetCurrent(), timer, .commonModes)

note("keyboard_mac: reading keyboard (Input Monitoring granted) — multi-key, only while the video window is focused.")
CFRunLoopRun()

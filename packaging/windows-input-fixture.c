#define UNICODE
#define _UNICODE
#include <windows.h>
#include <stdio.h>

static void key(WORD code, DWORD flags) {
    INPUT input = {0}; input.type = INPUT_KEYBOARD;
    input.ki.wVk = code; input.ki.dwFlags = flags;
    SendInput(1, &input, sizeof(input));
}

static void pump(unsigned milliseconds) {
    ULONGLONG end = GetTickCount64() + milliseconds;
    do {
        MSG message;
        while (PeekMessageW(&message, NULL, 0, 0, PM_REMOVE)) { TranslateMessage(&message); DispatchMessageW(&message); }
        Sleep(5);
    } while (GetTickCount64() < end);
}

static int activate(HWND window) {
    ShowWindow(window, SW_SHOW);
    for (int attempt = 0; attempt < 10; attempt++) {
        HWND foreground = GetForegroundWindow();
        DWORD current = GetCurrentThreadId();
        DWORD other = foreground ? GetWindowThreadProcessId(foreground, NULL) : 0;
        BOOL attached = other && other != current && AttachThreadInput(current, other, TRUE);
        if (attempt) { key(VK_MENU, 0); key(VK_MENU, KEYEVENTF_KEYUP); }
        BringWindowToTop(window); SetForegroundWindow(window); SetFocus(window);
        if (attached) AttachThreadInput(current, other, FALSE);
        pump(200);
        if (GetForegroundWindow() == window) return 1;
    }
    DWORD session = 0, needed = 0;
    wchar_t name[80] = L"unavailable";
    ProcessIdToSessionId(GetCurrentProcessId(), &session);
    HDESK desktop = OpenInputDesktop(0, FALSE, DESKTOP_READOBJECTS);
    DWORD error = GetLastError();
    if (desktop) { GetUserObjectInformationW(desktop, UOI_NAME, name, sizeof(name), &needed); CloseDesktop(desktop); }
    printf("FOCUS_DIAGNOSTIC session=%lu foreground=%p target=%p input_desktop=%ls error=%lu\n",
        session, (void *)GetForegroundWindow(), (void *)window, name, error);
    return 0;
}

int main(void) {
    WNDCLASSW type = {0};
    type.lpfnWndProc = DefWindowProcW;
    type.hInstance = GetModuleHandleW(NULL);
    type.lpszClassName = L"WLtoysInputCheck";
    if (!RegisterClassW(&type)) return 1;
    HWND window = CreateWindowExW(0, type.lpszClassName, L"WLtoys keyboard verification", WS_OVERLAPPEDWINDOW,
        0, 0, 480, 240, NULL, NULL, type.hInstance, NULL);
    if (!window) return 1;
    if (!activate(window)) { DestroyWindow(window); puts("NO_INTERACTIVE_DESKTOP"); return 2; }
    for (int attempt = 0; attempt < 20; attempt++) {
        if (SendMessageW(window, WM_GETICON, ICON_BIG, 0) && SendMessageW(window, WM_GETICON, ICON_SMALL, 0)) break;
        pump(100);
    }
    if (!SendMessageW(window, WM_GETICON, ICON_BIG, 0) || !SendMessageW(window, WM_GETICON, ICON_SMALL, 0)) {
        DestroyWindow(window); puts("MISSING_WINDOW_ICONS"); return 3;
    }
    puts("PASS window icons");
    key('W', 0); key('D', 0); pump(500);
    key('W', KEYEVENTF_KEYUP); key('D', KEYEVENTF_KEYUP); pump(350);
    key(VK_DOWN, 0); pump(120); key(VK_DOWN, KEYEVENTF_KEYUP); pump(120);
    key(VK_RETURN, 0); pump(120); key(VK_RETURN, KEYEVENTF_KEYUP); pump(120);
    RECT bounds; GetClientRect(window, &bounds);
    POINT point = {bounds.right / 2, bounds.bottom / 2}; ClientToScreen(window, &point);
    SetCursorPos(point.x, point.y);
    INPUT click = {0}; click.type = INPUT_MOUSE; click.mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
    SendInput(1, &click, sizeof(click)); pump(120);
    click.mi.dwFlags = MOUSEEVENTF_LEFTUP; SendInput(1, &click, sizeof(click)); pump(120);
    // A physically held key must cease driving when the player loses focus.
    key('W', 0); pump(300); ShowWindow(window, SW_HIDE); pump(400);
    key('W', KEYEVENTF_KEYUP);
    DestroyWindow(window); return 0;
}

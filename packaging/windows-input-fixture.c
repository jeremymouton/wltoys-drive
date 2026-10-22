#define UNICODE
#define _UNICODE
#include <windows.h>
#include <stdio.h>

static void key(WORD code, DWORD flags) {
    INPUT input = {0}; input.type = INPUT_KEYBOARD;
    input.ki.wVk = code; input.ki.dwFlags = flags;
    SendInput(1, &input, sizeof(input));
}

int main(void) {
    HWND window = CreateWindowExW(0, L"STATIC", L"WLtoys keyboard verification", WS_OVERLAPPEDWINDOW,
        0, 0, 480, 240, NULL, NULL, GetModuleHandleW(NULL), NULL);
    if (!window) return 1;
    ShowWindow(window, SW_SHOW); SetForegroundWindow(window); Sleep(300);
    if (GetForegroundWindow() != window) { DestroyWindow(window); puts("NO_INTERACTIVE_DESKTOP"); return 2; }
    key('W', 0); key('D', 0); Sleep(500);
    key('W', KEYEVENTF_KEYUP); key('D', KEYEVENTF_KEYUP); Sleep(350);
    key(VK_DOWN, 0); Sleep(120); key(VK_DOWN, KEYEVENTF_KEYUP); Sleep(120);
    key(VK_RETURN, 0); Sleep(120); key(VK_RETURN, KEYEVENTF_KEYUP); Sleep(120);
    RECT bounds; GetClientRect(window, &bounds);
    POINT point = {bounds.right / 2, bounds.bottom / 2}; ClientToScreen(window, &point);
    SetCursorPos(point.x, point.y);
    INPUT click = {0}; click.type = INPUT_MOUSE; click.mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
    SendInput(1, &click, sizeof(click)); Sleep(120);
    click.mi.dwFlags = MOUSEEVENTF_LEFTUP; SendInput(1, &click, sizeof(click)); Sleep(120);
    // A physically held key must cease driving when the player loses focus.
    key('W', 0); Sleep(300); ShowWindow(window, SW_HIDE); Sleep(400);
    key('W', KEYEVENTF_KEYUP);
    DestroyWindow(window); return 0;
}

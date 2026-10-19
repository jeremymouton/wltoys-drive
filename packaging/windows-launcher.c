#define UNICODE
#define _UNICODE
#include <windows.h>
#include <wchar.h>
#include <stdio.h>

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR tail, int show) {
    (void)instance; (void)previous; (void)show;
    wchar_t folder[32768], node[32768], command[65536], log[32768];
    GetModuleFileNameW(NULL, folder, 32768);
    wchar_t *slash = wcsrchr(folder, L'\\'); if (!slash) return 1; *slash = 0;
    swprintf(node, 32768, L"%ls\\bin\\node.exe", folder);
    swprintf(command, 65536, L"\"%ls\" \"%ls\\drive.mjs\" %ls", node, folder, tail);
    DWORD size = GetEnvironmentVariableW(L"USERPROFILE", log, 32768);
    if (!size || size > 32000) return 1;
    wcscat(log, L"\\wltoys-drive.log");
    SECURITY_ATTRIBUTES security = {sizeof(security), NULL, TRUE};
    HANDLE output = CreateFileW(log, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, &security, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (output == INVALID_HANDLE_VALUE) return 1;
    STARTUPINFOW startup = {0}; startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdOutput = output; startup.hStdError = output;
    startup.hStdInput = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ, &security, OPEN_EXISTING, 0, NULL);
    PROCESS_INFORMATION process;
    BOOL ok = CreateProcessW(node, command, NULL, NULL, TRUE, CREATE_NO_WINDOW, NULL, folder, &startup, &process);
    CloseHandle(output); CloseHandle(startup.hStdInput);
    if (!ok) { MessageBoxW(NULL, L"Could not launch WLtoys Drive. Extract the complete ZIP before opening the app.", L"WLtoys Drive", MB_OK | MB_ICONERROR); return 1; }
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD code; GetExitCodeProcess(process.hProcess, &code);
    if (code && !*tail) MessageBoxW(NULL, L"WLtoys Drive stopped. Details are in wltoys-drive.log in your user folder.", L"WLtoys Drive", MB_OK | MB_ICONERROR);
    CloseHandle(process.hThread); CloseHandle(process.hProcess); return (int)code;
}

#define UNICODE
#define _UNICODE
#define _WIN32_WINNT 0x0601
#include <winsock2.h>
#include <windows.h>
#include <wlanapi.h>
#include <iphlpapi.h>
#include <xinput.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <io.h>
#include <fcntl.h>
#include <wchar.h>

static void event(short value, unsigned char type, unsigned char number) {
    unsigned char b[8] = {0};
    b[4] = (unsigned short)value & 255;
    b[5] = ((unsigned short)value >> 8) & 255;
    b[6] = type; b[7] = number;
    fwrite(b, 1, 8, stdout);
}

static int focused(void) {
    HWND window = GetForegroundWindow();
    DWORD pid = 0;
    GetWindowThreadProcessId(window, &pid);
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
    wchar_t file[32768]; DWORD size = 32768;
    int ok = process && QueryFullProcessImageNameW(process, 0, file, &size);
    if (process) CloseHandle(process);
    if (!ok) return 0;
    wchar_t *name = wcsrchr(file, L'\\');
    return name && _wcsicmp(name + 1, L"mpv.exe") == 0;
}

static void keyboard(void) {
    const int keys[] = {'W','A','S','D',VK_UP,VK_DOWN,VK_LEFT,VK_RIGHT,VK_SPACE};
    const char *names[] = {"w","a","s","d","UP","DOWN","LEFT","RIGHT","SPACE"};
    int oldH = 0, oldR = 0;
    for (;;) {
        int active = focused(), any = 0;
        fputs("KEYS", stdout);
        for (unsigned i = 0; i < sizeof(keys)/sizeof(keys[0]); i++) {
            if (active && (GetAsyncKeyState(keys[i]) & 0x8000)) {
                printf(" %s", names[i]); any = 1;
            }
        }
        if (!any) fputs(" -", stdout);
        putchar('\n');
        int h = (GetAsyncKeyState('H') & 0x8000) != 0;
        int r = (GetAsyncKeyState('R') & 0x8000) != 0;
        if (active && h && !oldH) puts("HUD");
        if (active && r && !oldR) puts("REC");
        oldH = h; oldR = r;
        fflush(stdout); Sleep(20);
    }
}

static int car_ssid(const wchar_t *ssid) {
    size_t n = wcslen(ssid);
    if (n < 19 || n > 32 || _wcsnicmp(ssid, L"WL FPV CAR ", 11)) return 0;
    for (size_t i = 11; i < n; i++) if (ssid[i] < L'0' || ssid[i] > L'9') return 0;
    return 1;
}

static void print_ssid(DOT11_SSID ssid) {
    if (ssid.uSSIDLength > 32) return;
    char text[33] = {0}; wchar_t wide[33] = {0};
    memcpy(text, ssid.ucSSID, ssid.uSSIDLength);
    MultiByteToWideChar(CP_UTF8, 0, text, -1, wide, 33);
    if (car_ssid(wide)) puts(text);
}

static int gateway(const wchar_t *ip) {
    char target[64];
    WideCharToMultiByte(CP_UTF8, 0, ip, -1, target, sizeof(target), NULL, NULL);
    ULONG size = 16384;
    IP_ADAPTER_ADDRESSES *adapters = malloc(size);
    ULONG result = GetAdaptersAddresses(AF_INET, GAA_FLAG_INCLUDE_GATEWAYS, NULL, adapters, &size);
    if (result == ERROR_BUFFER_OVERFLOW) {
        free(adapters); adapters = malloc(size);
        result = GetAdaptersAddresses(AF_INET, GAA_FLAG_INCLUDE_GATEWAYS, NULL, adapters, &size);
    }
    int found = 0;
    if (!result) for (IP_ADAPTER_ADDRESSES *a = adapters; a; a = a->Next) {
        if (a->IfType != IF_TYPE_IEEE80211 || a->OperStatus != IfOperStatusUp) continue;
        for (IP_ADAPTER_GATEWAY_ADDRESS *g = a->FirstGatewayAddress; g; g = g->Next) {
            SOCKADDR_IN *addr = (SOCKADDR_IN *)g->Address.lpSockaddr;
            if (addr->sin_family == AF_INET && !strcmp(inet_ntoa(addr->sin_addr), target)) found = 1;
        }
    }
    free(adapters);
    if (found) puts("ON");
    return found ? 0 : 1;
}

static int wifi(int argc, wchar_t **argv) {
    HANDLE client; DWORD version, error;
    error = WlanOpenHandle(2, NULL, &version, &client);
    if (error) return (int)error;
    WLAN_INTERFACE_INFO_LIST *interfaces = NULL;
    error = WlanEnumInterfaces(client, NULL, &interfaces);
    if (error) { WlanCloseHandle(client, NULL); return (int)error; }
    DWORD result = ERROR_NOT_FOUND;
    for (DWORD i = 0; i < interfaces->dwNumberOfItems; i++) {
        GUID *id = &interfaces->InterfaceInfo[i].InterfaceGuid;
        if (!wcscmp(argv[1], L"--wifi-current")) {
            WLAN_CONNECTION_ATTRIBUTES *connection = NULL; DWORD bytes;
            error = WlanQueryInterface(client, id, wlan_intf_opcode_current_connection, NULL, &bytes, (void **)&connection, NULL);
            if (!error) { print_ssid(connection->wlanAssociationAttributes.dot11Ssid); WlanFreeMemory(connection); result = 0; }
        } else if (!wcscmp(argv[1], L"--wifi-saved")) {
            WLAN_PROFILE_INFO_LIST *profiles = NULL;
            error = WlanGetProfileList(client, id, NULL, &profiles);
            if (!error) {
                for (DWORD j = 0; j < profiles->dwNumberOfItems; j++) {
                    const wchar_t *s = profiles->ProfileInfo[j].strProfileName;
                    if (car_ssid(s)) wprintf(L"%ls\n", s);
                }
                WlanFreeMemory(profiles); result = 0;
            }
        } else if (!wcscmp(argv[1], L"--wifi-scan")) {
            WLAN_AVAILABLE_NETWORK_LIST *networks = NULL;
            error = WlanGetAvailableNetworkList(client, id, 0, NULL, &networks);
            if (!error) {
                for (DWORD j = 0; j < networks->dwNumberOfItems; j++) print_ssid(networks->Network[j].dot11Ssid);
                WlanFreeMemory(networks); result = 0;
            }
        } else if (!wcscmp(argv[1], L"--wifi-join") && argc == 3 && car_ssid(argv[2])) {
            const wchar_t *ssid = argv[2], *password = ssid + wcslen(ssid) - 8;
            wchar_t xml[4096]; DWORD reason;
            // Only a validated ASCII prefix and decimal digits enter the profile XML.
            swprintf(xml, 4096, L"<?xml version=\"1.0\"?><WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\"><name>%ls</name><SSIDConfig><SSID><name>%ls</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>manual</connectionMode><MSM><security><authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption><sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>%ls</keyMaterial></sharedKey></security></MSM></WLANProfile>", ssid, ssid, password);
            error = WlanSetProfile(client, id, WLAN_PROFILE_USER, xml, NULL, TRUE, NULL, &reason);
            if (!error) {
                WLAN_CONNECTION_PARAMETERS params = {0};
                params.wlanConnectionMode = wlan_connection_mode_profile;
                params.strProfile = ssid; params.dot11BssType = dot11_BSS_type_infrastructure;
                error = WlanConnect(client, id, &params, NULL);
            }
            result = error;
            if (!error) break;
        } else { result = ERROR_INVALID_PARAMETER; break; }
        if (error && result == ERROR_NOT_FOUND) result = error;
    }
    WlanFreeMemory(interfaces); WlanCloseHandle(client, NULL);
    if (result) fprintf(stderr, "Windows Wi-Fi error %lu; use Windows Wi-Fi settings if access is denied.\n", result);
    return (int)result;
}

int wmain(int argc, wchar_t **argv) {
    if (argc > 1 && !wcscmp(argv[1], L"--wifi-on") && argc == 3) return gateway(argv[2]);
    if (argc > 1 && !wcsncmp(argv[1], L"--wifi-", 7)) return wifi(argc, argv);
    if (argc > 1 && !wcscmp(argv[1], L"--keyboard")) { keyboard(); return 0; }
    _setmode(_fileno(stdout), _O_BINARY);
    HMODULE lib = LoadLibraryW(L"xinput1_4.dll");
    if (!lib) lib = LoadLibraryW(L"xinput9_1_0.dll");
    DWORD (WINAPI *getState)(DWORD, XINPUT_STATE *) = lib ? (void *)GetProcAddress(lib, "XInputGetState") : NULL;
    if (!getState) { fputs("XInput is unavailable\n", stderr); return 1; }
    int previous = -1;
    const WORD masks[] = {XINPUT_GAMEPAD_A, XINPUT_GAMEPAD_B, XINPUT_GAMEPAD_X, XINPUT_GAMEPAD_Y,
        XINPUT_GAMEPAD_LEFT_SHOULDER, XINPUT_GAMEPAD_RIGHT_SHOULDER, XINPUT_GAMEPAD_BACK, XINPUT_GAMEPAD_START};
    for (;;) {
        XINPUT_STATE state; int selected = -1;
        for (DWORD i = 0; i < 4; i++) if (!getState(i, &state)) { selected = (int)i; break; }
        event(selected >= 0, 0x40, 0);
        if (selected >= 0) {
            // Fixed rest values avoid calibrating a held trigger as neutral at startup.
            if (selected != previous) {
                for (int a = 0; a < 8; a++) event(0, 0x82, (unsigned char)a);
                for (int b = 0; b < 8; b++) event(0, 0x81, (unsigned char)b);
            }
            XINPUT_GAMEPAD *g = &state.Gamepad;
            event(g->sThumbLX == -32768 ? -32767 : g->sThumbLX, 2, 0);
            event(g->sThumbLY == -32768 ? 32767 : -g->sThumbLY, 2, 1);
            event(g->bLeftTrigger * 32767 / 255, 2, 2);
            event(g->bRightTrigger * 32767 / 255, 2, 5);
            event(((g->wButtons & XINPUT_GAMEPAD_DPAD_RIGHT) != 0) * 32767 - ((g->wButtons & XINPUT_GAMEPAD_DPAD_LEFT) != 0) * 32767, 2, 6);
            event(((g->wButtons & XINPUT_GAMEPAD_DPAD_DOWN) != 0) * 32767 - ((g->wButtons & XINPUT_GAMEPAD_DPAD_UP) != 0) * 32767, 2, 7);
            for (int b = 0; b < 8; b++) event((g->wButtons & masks[b]) != 0, 1, (unsigned char)b);
        }
        previous = selected; fflush(stdout); Sleep(20);
    }
}

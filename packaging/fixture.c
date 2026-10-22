#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifdef _WIN32
#include <windows.h>
#include <process.h>
#define pause_ms(n) Sleep(n)
#else
#include <unistd.h>
#define pause_ms(n) usleep((n)*1000)
#endif

static int wifi_fixture(int argc, char **argv) {
    const char *scenario = getenv("FIXTURE_STARTUP_CASE"), *ready = getenv("FIXTURE_READY");
    const char *state = getenv("FIXTURE_WIFI_STATE"), *counter = getenv("FIXTURE_SCAN_COUNT");
    if (!scenario || !ready || !state || !counter) return 2;
    FILE *file = fopen(ready, "r");
    if (!file) { fputs("Wi-Fi ran before the video window loaded\n", stderr); return 3; }
    fclose(file);
    if (!strcmp(argv[1], "--wifi-scan")) {
        int count = 0;
        file = fopen(counter, "r"); if (file) { fscanf(file, "%d", &count); fclose(file); }
        file = fopen(counter, "w"); if (file) { fprintf(file, "%d", count + 1); fclose(file); }
        pause_ms(300);
        if (!strcmp(scenario, "permission")) return 5;
        if (!strcmp(scenario, "empty") || (!strcmp(scenario, "late") && !count)) return 0;
        puts("WL FPV CAR 11111111");
        if (!strcmp(scenario, "multiple")) puts("WL FPV CAR 22222222");
        return 0;
    }
    if (!strcmp(argv[1], "--wifi-current") || !strcmp(argv[1], "--wifi-on")) {
        char ssid[64]; file = fopen(state, "r");
        if (!file) return 1;
        if (fgets(ssid, sizeof(ssid), file)) fputs(ssid, stdout);
        fclose(file); return 0;
    }
    if (!strcmp(argv[1], "--wifi-join") && argc == 3) {
        file = fopen(state, "w"); if (!file) return 1;
        fprintf(file, "%s\n", argv[2]); fclose(file);
        fprintf(stderr, "fixture:join:%s\n", argv[2]); fflush(stderr);
        return 0;
    }
    return 1;
}

int main(int argc, char **argv) {
    if (argc > 1 && !strncmp(argv[1], "--wifi-", 7)) return wifi_fixture(argc, argv);
    if (argc > 1 && !strcmp(argv[1], "--probe")) { puts("OK"); return 0; }
    if (argc == 1 || (argc == 2 && !strcmp(argv[1], "--keyboard"))) {
        const char *ready = getenv("FIXTURE_READY");
        if (ready) {
            for (int attempt = 0; attempt < 600; attempt++) {
                FILE *flag = fopen(ready, "r");
                if (flag) { fclose(flag); break; }
                puts("KEYS -"); fflush(stdout); pause_ms(20);
            }
        }
#ifdef _WIN32
        unsigned long long start = GetTickCount64();
#else
        struct timespec tick; clock_gettime(CLOCK_MONOTONIC, &tick);
        unsigned long long start = tick.tv_sec * 1000ULL + tick.tv_nsec / 1000000;
#endif
        int previous = -1;
        for (;;) {
#ifdef _WIN32
            unsigned long long elapsed = GetTickCount64() - start;
#else
            clock_gettime(CLOCK_MONOTONIC, &tick);
            unsigned long long elapsed = tick.tv_sec * 1000ULL + tick.tv_nsec / 1000000 - start;
#endif
            if (elapsed > 12000) break;
            int stage = elapsed < 800 ? 0 : elapsed < 1400 ? 1 : elapsed < 1800 ? 2 : elapsed < 2200 ? 3 : elapsed < 2800 ? 4 : 5;
            const char *markers[] = {"idle", "turn", "release", "forward", "stale", "done"};
            if (stage != previous) {
                fprintf(stderr, "fixture:%s\n", markers[stage]); fflush(stderr); previous = stage;
                const char *scenario = getenv("FIXTURE_STARTUP_CASE");
                if (stage == 1 && scenario && !strcmp(scenario, "multiple")) {
                    puts("UI DOWN\nUI SELECT"); fflush(stdout);
                    fputs("fixture:selection\n", stderr); fflush(stderr);
                }
            }
            if (stage == 1) puts("KEYS w d");
            else if (stage == 3) puts("KEYS w");
            else if (stage != 4) puts("KEYS -");
            fflush(stdout); pause_ms(20);
        }
        return 0;
    }
    const char *mpv = getenv("FIXTURE_MPV"), *lua = getenv("FIXTURE_LUA");
    if (!mpv || !lua) return 1;
    char script[32768]; snprintf(script, sizeof(script), "--script=%s", lua);
    char **args = calloc((size_t)argc + 5, sizeof(char *));
    args[0] = (char *)mpv;
    for (int i = 1; i < argc; i++) args[i] = argv[i];
    args[argc] = "--vo=null"; args[argc + 1] = "--hwdec=no"; args[argc + 2] = script;
#ifdef _WIN32
    char command[65536] = {0};
    for (int i = 0; args[i]; i++) {
        strcat(command, "\""); strcat(command, args[i]); strcat(command, "\" ");
    }
    STARTUPINFOA startup = {0}; startup.cb = sizeof(startup);
    PROCESS_INFORMATION process;
    if (!CreateProcessA(mpv, command, NULL, NULL, TRUE, 0, NULL, NULL, &startup, &process)) return 1;
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD code; GetExitCodeProcess(process.hProcess, &code);
    CloseHandle(process.hThread); CloseHandle(process.hProcess); return (int)code;
#else
    execv(mpv, args); perror("mpv fixture"); return 1;
#endif
}

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
#include <process.h>
#define pause_ms(n) Sleep(n)
#else
#include <unistd.h>
#define pause_ms(n) usleep((n)*1000)
#endif

int main(int argc, char **argv) {
    if (argc > 1 && !strcmp(argv[1], "--probe")) { puts("OK"); return 0; }
    if (argc == 1 || (argc == 2 && !strcmp(argv[1], "--keyboard"))) {
        for (int i = 0; i < 600; i++) {
            if (i < 40) puts("KEYS -");
            else if (i < 70) puts("KEYS w d");
            else if (i < 90) puts("KEYS -");
            else if (i < 110) puts("KEYS w");
            else if (i < 140) { pause_ms(20); continue; }
            else puts("KEYS -");
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
    return (int)_spawnv(_P_WAIT, mpv, (const char *const *)args);
#else
    execv(mpv, args); perror("mpv fixture"); return 1;
#endif
}

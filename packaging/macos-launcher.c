#include <mach-o/dyld.h>
#include <libgen.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

int main(int argc, char **argv) {
    char executable[4096], root[4096], node[4096], script[4096];
    uint32_t size = sizeof(executable);
    if (_NSGetExecutablePath(executable, &size)) return 1;
    snprintf(root, sizeof(root), "%s/../Resources", dirname(executable));
    snprintf(node, sizeof(node), "%s/bin/node", root);
    snprintf(script, sizeof(script), "%s/drive.mjs", root);
    if (argc == 1) {
        const char *home = getenv("HOME");
        if (home) {
            char log[4096]; snprintf(log, sizeof(log), "%s/wltoys-drive.log", home);
            freopen(log, "a", stderr); dup2(fileno(stderr), STDOUT_FILENO);
        }
    }
    char **args = calloc((size_t)argc + 2, sizeof(char *));
    args[0] = node; args[1] = script;
    for (int i = 1; i < argc; i++) args[i + 1] = argv[i];
    execv(node, args);
    perror("Could not launch WLtoys Drive"); return 1;
}

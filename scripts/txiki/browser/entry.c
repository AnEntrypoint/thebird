#include <stddef.h>
#include "tjs.h"

int tjs_browser_eval(const char *code) {
    char *argv[] = {"tjs", "-e", (char *) code, NULL};
    TJS_Initialize(3, argv);
    TJSRuntime *qrt = TJS_NewRuntime();
    if (!qrt) return 1;
    int exit_code = TJS_Run(qrt);
    TJS_FreeRuntime(qrt);
    return exit_code;
}

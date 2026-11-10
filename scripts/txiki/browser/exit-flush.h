#include <stdlib.h>
void tjs_browser_exit(int status);
#define exit(status) tjs_browser_exit(status)

#define GL_SILENCE_DEPRECATION
#import <Cocoa/Cocoa.h>
#import <OpenGL/gl3.h>
#import <mpv/client.h>
#import <mpv/render_gl.h>
#include <mach-o/dyld.h>
#include <dlfcn.h>
#include <unistd.h>
#include <stdatomic.h>

static mpv_handle *client;
static mpv_render_context *renderer;
static NSOpenGLView *videoView;
static NSMutableSet<NSString *> *held;
static BOOL stopping;
static atomic_bool framePending = true;

static void line(NSString *value) {
    fprintf(stdout, "%s\n", value.UTF8String); fflush(stdout);
}

static void clearKeys(void) {
    [held removeAllObjects]; line(@"KEYS -");
}

static void finish(int code) {
    if (stopping) return;
    stopping = YES; clearKeys();
    if (renderer) {
        mpv_render_context_set_update_callback(renderer, NULL, NULL);
        [videoView.openGLContext makeCurrentContext];
        mpv_render_context_free(renderer); renderer = NULL;
    }
    if (client) { mpv_terminate_destroy(client); client = NULL; }
    exit(code);
}

static void check(int result) {
    if (result < 0) { fprintf(stderr, "[player] %s\n", mpv_error_string(result)); finish(1); }
}

static NSString *keyName(unsigned short code) {
    switch (code) {
        case 13: return @"w"; case 0: return @"a"; case 1: return @"s"; case 2: return @"d";
        case 126: return @"UP"; case 125: return @"DOWN"; case 123: return @"LEFT"; case 124: return @"RIGHT";
        case 49: return @"SPACE";
        default: return nil;
    }
}

static void heartbeat(void) {
    NSString *keys = [[held.allObjects sortedArrayUsingSelector:@selector(compare:)] componentsJoinedByString:@" "];
    line(keys.length ? [@"KEYS " stringByAppendingString:keys] : @"KEYS -");
}

@interface DriveView : NSOpenGLView
@end
@implementation DriveView
- (BOOL)acceptsFirstResponder { return YES; }
- (void)keyDown:(NSEvent *)event {
    if (event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl | NSEventModifierFlagOption)) return;
    NSString *name = keyName(event.keyCode);
    if (name) { [held addObject:name]; heartbeat(); }
    if (event.keyCode == 126) line(@"UI UP");
    else if (event.keyCode == 125) line(@"UI DOWN");
    else if (!event.isARepeat && (event.keyCode == 36 || event.keyCode == 76)) line(@"UI SELECT");
    else if (!event.isARepeat && event.keyCode == 4) line(@"HUD");
    else if (!event.isARepeat && event.keyCode == 15) line(@"REC");
}
- (void)mouseDown:(NSEvent *)event {
    NSPoint point = [self convertPoint:event.locationInWindow fromView:nil];
    line([NSString stringWithFormat:@"UI CLICK %.1f %.1f", point.x * 1280 / self.bounds.size.width,
        (self.bounds.size.height - point.y) * 720 / self.bounds.size.height]);
}
- (void)keyUp:(NSEvent *)event {
    NSString *name = keyName(event.keyCode);
    if (name) { [held removeObject:name]; heartbeat(); }
}
- (void)flagsChanged:(NSEvent *)event {
    if (event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl | NSEventModifierFlagOption)) clearKeys();
}
- (void)drawRect:(NSRect)dirtyRect {
    (void)dirtyRect;
    [self.openGLContext makeCurrentContext];
    if (renderer) {
        NSRect pixels = [self convertRectToBacking:self.bounds];
        mpv_opengl_fbo fbo = {.fbo = 0, .w = (int)pixels.size.width, .h = (int)pixels.size.height};
        int flip = 1, block = 0;
        mpv_render_param params[] = {{MPV_RENDER_PARAM_OPENGL_FBO, &fbo}, {MPV_RENDER_PARAM_FLIP_Y, &flip}, {MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, &block}, {0}};
        mpv_render_context_render(renderer, params);
    } else { glClearColor(0, 0, 0, 1); glClear(GL_COLOR_BUFFER_BIT); }
    [self.openGLContext flushBuffer];
}
@end

@interface DriveDelegate : NSObject <NSWindowDelegate, NSApplicationDelegate>
@end
@implementation DriveDelegate
- (void)windowDidResignKey:(NSNotification *)note { (void)note; clearKeys(); }
- (void)applicationDidResignActive:(NSNotification *)note { (void)note; clearKeys(); }
- (void)windowWillClose:(NSNotification *)note { (void)note; finish(0); }
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender { (void)sender; finish(0); return NSTerminateNow; }
@end

static void *glAddress(void *ctx, const char *name) { (void)ctx; return dlsym(RTLD_DEFAULT, name); }
static void redraw(void *ctx) {
    (void)ctx;
    atomic_store(&framePending, true);
}
static void events(void *ctx) {
    (void)ctx;
    dispatch_async(dispatch_get_main_queue(), ^{
        if (stopping || !client) return;
        for (;;) {
            mpv_event *event = mpv_wait_event(client, 0);
            if (event->event_id == MPV_EVENT_NONE) break;
            if (event->event_id == MPV_EVENT_LOG_MESSAGE) {
                mpv_event_log_message *message = event->data;
                fprintf(stderr, "[player/%s] %s", message->prefix, message->text);
            } else if (event->event_id == MPV_EVENT_END_FILE) {
                mpv_event_end_file *end = event->data;
                if (end->reason != MPV_END_FILE_REASON_REDIRECT && end->reason != MPV_END_FILE_REASON_STOP) finish(end->error < 0 ? 1 : 0);
            } else if (event->event_id == MPV_EVENT_SHUTDOWN) finish(0);
        }
    });
}

static NSEvent *testKey(NSEventType type, unsigned short code, BOOL repeat) {
    return [NSEvent keyEventWithType:type location:NSZeroPoint modifierFlags:0 timestamp:0
        windowNumber:0 context:nil characters:@"" charactersIgnoringModifiers:@"" isARepeat:repeat keyCode:code];
}
static int inputSelftest(void) {
    @autoreleasepool {
        held = [NSMutableSet new];
        DriveView *view = [[DriveView alloc] initWithFrame:NSZeroRect];
        [view keyDown:testKey(NSEventTypeKeyDown, 13, NO)];
        [view keyDown:testKey(NSEventTypeKeyDown, 2, NO)];
        if (![held containsObject:@"w"] || ![held containsObject:@"d"] || held.count != 2) return 1;
        [view keyUp:testKey(NSEventTypeKeyUp, 13, NO)];
        if ([held containsObject:@"w"] || ![held containsObject:@"d"]) return 1;
        [view keyDown:testKey(NSEventTypeKeyDown, 49, NO)];
        if (![held containsObject:@"SPACE"]) return 1;
        [view keyDown:testKey(NSEventTypeKeyDown, 4, NO)];
        [view keyDown:testKey(NSEventTypeKeyDown, 4, YES)];
        [view keyDown:testKey(NSEventTypeKeyDown, 15, NO)];
        [view keyDown:testKey(NSEventTypeKeyDown, 15, YES)];
        [[DriveDelegate new] windowDidResignKey:[NSNotification notificationWithName:NSWindowDidResignKeyNotification object:nil]];
        if (held.count) return 1;
        [view keyDown:testKey(NSEventTypeKeyDown, 126, NO)];
        [view keyDown:testKey(NSEventTypeKeyDown, 124, NO)];
        if (![held containsObject:@"UP"] || ![held containsObject:@"RIGHT"]) return 1;
        [[DriveDelegate new] applicationDidResignActive:[NSNotification notificationWithName:NSApplicationDidResignActiveNotification object:nil]];
        if (held.count) return 1;
        puts("PASS window-local keyboard: combined keys, release, stop, toggles and focus loss");
        return 0;
    }
}

int main(int argc, char **argv) {
    if (argc == 2 && !strcmp(argv[1], "--input-selftest")) return inputSelftest();
    // Keep CLI diagnostics and headless verification in the regular player.
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--list-options") || !strcmp(argv[i], "--version") || !strcmp(argv[i], "--vo=null")) {
            char executable[4096]; uint32_t size = sizeof(executable);
            if (!_NSGetExecutablePath(executable, &size)) {
                char *slash = strrchr(executable, '/');
                if (slash) {
                    *slash = 0; char fallback[8192];
                    snprintf(fallback, sizeof(fallback), "%s/../../../bin/mpv", executable);
                    if (!access(fallback, X_OK)) execv(fallback, argv);
                }
            }
            execvp("mpv", argv); perror("mpv"); return 1;
        }
    }
    @autoreleasepool {
        [NSApplication sharedApplication];
        [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
        DriveDelegate *delegate = [DriveDelegate new]; NSApp.delegate = delegate;
        held = [NSMutableSet new];
        client = mpv_create(); if (!client) return 1;
        const char *source = NULL; BOOL fullscreen = NO;
        for (int i = 1; i < argc; i++) {
            NSString *arg = @(argv[i]);
            if (![arg hasPrefix:@"--"]) { source = argv[i]; continue; }
            NSString *option = [arg substringFromIndex:2], *value = @"yes";
            NSRange equal = [option rangeOfString:@"="];
            if (equal.location != NSNotFound) { value = [option substringFromIndex:equal.location + 1]; option = [option substringToIndex:equal.location]; }
            else if ([option hasPrefix:@"no-"]) { option = [option substringFromIndex:3]; value = @"no"; }
            if ([option isEqualToString:@"fullscreen"]) fullscreen = [value isEqualToString:@"yes"];
            if ([option isEqualToString:@"autofit"] || [option isEqualToString:@"terminal"]) continue;
            int result;
            if ([option isEqualToString:@"script"]) {
                mpv_node script = {.format = MPV_FORMAT_STRING, .u.string = (char *)value.UTF8String};
                mpv_node_list scripts = {.num = 1, .values = &script};
                mpv_node node = {.format = MPV_FORMAT_NODE_ARRAY, .u.list = &scripts};
                result = mpv_set_option(client, "scripts", MPV_FORMAT_NODE, &node);
            } else result = mpv_set_option_string(client, option.UTF8String, value.UTF8String);
            if (result < 0) { fprintf(stderr, "[player] option %s: %s\n", option.UTF8String, mpv_error_string(result)); finish(1); }
        }
        if (!source) { fprintf(stderr, "[player] No video source\n"); finish(1); }
        check(mpv_set_option_string(client, "terminal", "no"));
        check(mpv_set_option_string(client, "vo", "libmpv"));
        check(mpv_set_option_string(client, "force-window", "no"));
        check(mpv_set_option_string(client, "input-media-keys", "no"));
        check(mpv_set_option_string(client, "input-vo-keyboard", "no"));
        check(mpv_set_option_string(client, "input-default-bindings", "no"));
        check(mpv_request_log_messages(client, "warn"));
        check(mpv_initialize(client));

        NSRect frame = NSMakeRect(0, 0, 1280, 720);
        NSRect screen = NSScreen.mainScreen.visibleFrame;
        if (screen.size.width < 1280 || screen.size.height < 760) frame.size = NSMakeSize(screen.size.width * 0.85, screen.size.width * 0.85 * 9 / 16);
        NSWindow *window = [[NSWindow alloc] initWithContentRect:frame
            styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
            backing:NSBackingStoreBuffered defer:NO];
        window.title = @"WLtoys Drive"; window.delegate = delegate; window.contentMinSize = NSMakeSize(320, 180);
        NSOpenGLPixelFormatAttribute attributes[] = {NSOpenGLPFAOpenGLProfile, NSOpenGLProfileVersion3_2Core, NSOpenGLPFADoubleBuffer, NSOpenGLPFAAccelerated, 0};
        NSOpenGLPixelFormat *format = [[NSOpenGLPixelFormat alloc] initWithAttributes:attributes];
        if (!format) { fprintf(stderr, "[player] OpenGL context unavailable\n"); finish(1); }
        DriveView *view = [[DriveView alloc] initWithFrame:frame pixelFormat:format];
        view.wantsBestResolutionOpenGLSurface = YES;
        videoView = view; window.contentView = view;
        [view.openGLContext makeCurrentContext];
        GLint interval = 1; [view.openGLContext setValues:&interval forParameter:NSOpenGLContextParameterSwapInterval];
        mpv_opengl_init_params gl = {.get_proc_address = glAddress};
        mpv_render_param params[] = {{MPV_RENDER_PARAM_API_TYPE, MPV_RENDER_API_TYPE_OPENGL}, {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl}, {0}};
        check(mpv_render_context_create(&renderer, client, params));
        mpv_render_context_set_update_callback(renderer, redraw, NULL);
        mpv_set_wakeup_callback(client, events, NULL);
        [window center]; [window makeKeyAndOrderFront:nil]; [window makeFirstResponder:view];
        NSMenu *menu = [NSMenu new]; NSMenuItem *item = [NSMenuItem new]; [menu addItem:item];
        item.submenu = [NSMenu new]; [item.submenu addItemWithTitle:@"Quit WLtoys Drive" action:@selector(terminate:) keyEquivalent:@"q"];
        NSApp.mainMenu = menu;
        [NSApp activateIgnoringOtherApps:YES];
        if (fullscreen) [window toggleFullScreen:nil];
        NSTimer *timer = [NSTimer timerWithTimeInterval:0.05 repeats:YES block:^(NSTimer *t) {
            (void)t;
            if (!window.isKeyWindow || !NSApp.isActive) clearKeys(); else heartbeat();
        }];
        [[NSRunLoop mainRunLoop] addTimer:timer forMode:NSRunLoopCommonModes];
        NSTimer *paint = [NSTimer timerWithTimeInterval:1.0 / 60 repeats:YES block:^(NSTimer *t) {
            (void)t;
            if (atomic_exchange(&framePending, false)) [view setNeedsDisplay:YES];
        }];
        [[NSRunLoop mainRunLoop] addTimer:paint forMode:NSRunLoopCommonModes];
        const char *command[] = {"loadfile", source, NULL}; check(mpv_command_async(client, 0, command));
        [NSApp run]; finish(0);
    }
    return 0;
}

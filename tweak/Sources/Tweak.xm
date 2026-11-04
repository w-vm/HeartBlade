// Heartblade — native loader.
// Waits for Discord's Hermes runtime, exposes a small file API to JS (__HB_NATIVE__)
// and evaluates the Heartblade client bundle inside it.
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <jsi/jsi.h>
#import <string>
#import <vector>

#import "Store.h"
#import "Panel.h"

using namespace facebook;

@interface RCTHost : NSObject
- (void)instance:(id)instance didInitializeRuntime:(jsi::Runtime &)runtime;
@end

#pragma mark - host object

static std::string Str(jsi::Runtime &rt, const jsi::Value *args, size_t count, size_t i) {
    if (i >= count || !args[i].isString()) throw jsi::JSError(rt, "expected string argument");
    return args[i].asString(rt).utf8(rt);
}

static void Define(jsi::Runtime &rt, jsi::Object &obj, const char *name, unsigned argc, jsi::HostFunctionType fn) {
    obj.setProperty(rt, name, jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forUtf8(rt, name), argc, std::move(fn)));
}

static void InstallHostObject(jsi::Runtime &rt) {
    jsi::Object host(rt);
    host.setProperty(rt, "version", jsi::String::createFromUtf8(rt, [HB_VERSION UTF8String]));
    host.setProperty(rt, "dir", jsi::String::createFromUtf8(rt, HBDirectory().path.UTF8String));

    Define(rt, host, "readFile", 1, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t n) -> jsi::Value {
        NSURL *u = HBResolve([NSString stringWithUTF8String:Str(rt, a, n, 0).c_str()]);
        NSData *d = u ? [NSData dataWithContentsOfURL:u] : nil;
        if (!d) return jsi::Value::null();
        return jsi::String::createFromUtf8(rt, (const uint8_t *)d.bytes, d.length);
    });

    Define(rt, host, "writeFile", 2, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t n) -> jsi::Value {
        NSURL *u = HBResolve([NSString stringWithUTF8String:Str(rt, a, n, 0).c_str()]);
        if (!u) return false;
        std::string body = Str(rt, a, n, 1);
        [[NSFileManager defaultManager] createDirectoryAtURL:u.URLByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
        NSData *d = [NSData dataWithBytes:body.data() length:body.size()];
        return (bool)[d writeToURL:u atomically:YES];
    });

    Define(rt, host, "exists", 1, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t n) -> jsi::Value {
        NSURL *u = HBResolve([NSString stringWithUTF8String:Str(rt, a, n, 0).c_str()]);
        return (bool)(u && [[NSFileManager defaultManager] fileExistsAtPath:u.path]);
    });

    Define(rt, host, "removeFile", 1, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t n) -> jsi::Value {
        NSURL *u = HBResolve([NSString stringWithUTF8String:Str(rt, a, n, 0).c_str()]);
        return (bool)(u && [[NSFileManager defaultManager] removeItemAtURL:u error:nil]);
    });

    Define(rt, host, "listDir", 1, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t n) -> jsi::Value {
        NSURL *u = HBResolve([NSString stringWithUTF8String:Str(rt, a, n, 0).c_str()]);
        NSArray<NSString *> *names = u ? [[NSFileManager defaultManager] contentsOfDirectoryAtPath:u.path error:nil] : nil;
        jsi::Array out(rt, names.count);
        for (NSUInteger i = 0; i < names.count; i++) out.setValueAtIndex(rt, i, jsi::String::createFromUtf8(rt, names[i].UTF8String));
        return out;
    });

    Define(rt, host, "log", 1, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t n) -> jsi::Value {
        HBLog([NSString stringWithUTF8String:Str(rt, a, n, 0).c_str()] ?: @"(bad utf8)");
        return jsi::Value::undefined();
    });
    Define(rt, host, "setInfo", 1, [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *a, size_t n) -> jsi::Value {
        HBSetInfo([NSString stringWithUTF8String:Str(rt, a, n, 0).c_str()] ?: @"");
        return jsi::Value::undefined();
    });
    Define(rt, host, "openPanel", 0, [](jsi::Runtime &, const jsi::Value &, const jsi::Value *, size_t) -> jsi::Value {
        dispatch_async(dispatch_get_main_queue(), ^{ HBShowPanel(); });
        return jsi::Value::undefined();
    });
    Define(rt, host, "setSettingsEntry", 1, [](jsi::Runtime &, const jsi::Value &, const jsi::Value *a, size_t n) -> jsi::Value {
        HBSettingsEntryActive = n > 0 && a[0].isBool() && a[0].getBool();
        return jsi::Value::undefined();
    });

    rt.global().setProperty(rt, "__HB_NATIVE__", std::move(host));
}

#pragma mark - injection

static void EvaluateClient(jsi::Runtime &rt) {
    NSData *bundle = [NSData dataWithContentsOfURL:HBResolve(@"bundle.js")];
    if (!bundle.length) { HBLog(@"no client bundle yet (downloading for next launch)"); return; }
    try {
        std::string src((const char *)bundle.bytes, bundle.length);
        rt.evaluateJavaScript(std::make_shared<jsi::StringBuffer>(std::move(src)), "heartblade.js");
    } catch (const jsi::JSError &e) {
        HBLog([NSString stringWithFormat:@"ERROR bundle threw: %s", e.getMessage().c_str()]);
    } catch (const std::exception &e) {
        HBLog([NSString stringWithFormat:@"ERROR bundle failed: %s", e.what()]);
    }
}

%hook RCTHost

- (void)instance:(id)instance didInitializeRuntime:(jsi::Runtime &)runtime {
    %orig;

    @try {
        // Crash guard FIRST: if the last launch never reached the "all good" mark, turn the client off.
        NSFileManager *fm = NSFileManager.defaultManager;
        NSURL *flag = HBResolve(@"booting");
        if ([fm fileExistsAtPath:flag.path]) {
            [fm removeItemAtURL:flag error:nil];
            HBSetClientEnabled(NO);
            HBLog(@"Previous launch crashed during startup. Client disabled (Developer > Load client).");
        }
        if (!HBClientEnabled()) { HBLog(@"client is disabled"); return; }
        [@"1" writeToURL:flag atomically:YES encoding:NSUTF8StringEncoding error:nil];
        InstallHostObject(runtime);
        // The flag only means "we died while booting". Clear it after 8s, but ALSO when the app is backgrounded or
        // terminated: closing Discord within 8s (or while the main queue timer is suspended) used to leave the flag
        // behind, and the next launch then reported a crash that never happened and switched "Load client" off.
        void (^clearFlag)(NSNotification *) = ^(NSNotification *n) { [[NSFileManager defaultManager] removeItemAtURL:flag error:nil]; };
        NSNotificationCenter *nc = NSNotificationCenter.defaultCenter;
        [nc addObserverForName:UIApplicationDidEnterBackgroundNotification object:nil queue:nil usingBlock:clearFlag];
        [nc addObserverForName:UIApplicationWillTerminateNotification object:nil queue:nil usingBlock:clearFlag];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 8 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            [[NSFileManager defaultManager] removeItemAtURL:flag error:nil];
        });

        // Dev server: refresh synchronously (short timeout) so edits show up on next launch.
        if (HBDevURL().length) HBFetchBundleSync(3);
        EvaluateClient(runtime);

        // Fetch any newer release for the *next* launch (skipped when a dev URL is set).
        if (!HBDevURL().length) HBDownloadBundle(NO, nil);
    } @catch (NSException *ex) {
        HBLog([NSString stringWithFormat:@"ERROR injection failed: %@", ex]);
    }
}

%end

#pragma mark - shake to open panel

static NSTimeInterval gShakeStart = 0;

%hook UIWindow

- (void)motionBegan:(UIEventSubtype)motion withEvent:(UIEvent *)event {
    if (motion == UIEventSubtypeMotionShake) gShakeStart = [NSDate timeIntervalSinceReferenceDate];
    %orig;
}

- (void)motionEnded:(UIEventSubtype)motion withEvent:(UIEvent *)event {
    if (motion == UIEventSubtypeMotionShake && gShakeStart > 0 && HBShakeEnabled() && !HBSettingsEntryActive) {
        NSTimeInterval dur = [NSDate timeIntervalSinceReferenceDate] - gShakeStart;
        gShakeStart = 0;
        if (dur >= 0.5 && dur <= 2.0) dispatch_async(dispatch_get_main_queue(), ^{ HBShowPanel(); });
    }
    %orig;
}

%end

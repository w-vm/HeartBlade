#import "Store.h"
#import <CommonCrypto/CommonDigest.h>
#import <UIKit/UIKit.h>

static NSString *const kDevURLKey = @"dev.heartblade.devURL";

static NSError *HBError(NSString *msg) {
    return [NSError errorWithDomain:@"Heartblade" code:1 userInfo:@{NSLocalizedDescriptionKey: msg}];
}

NSURL *HBDirectory(void) {
    static NSURL *dir;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        NSURL *docs = [[NSFileManager defaultManager] URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject;
        dir = [docs URLByAppendingPathComponent:@"Heartblade" isDirectory:YES];
        [[NSFileManager defaultManager] createDirectoryAtURL:dir withIntermediateDirectories:YES attributes:nil error:nil];
    });
    return dir;
}

NSURL *HBResolve(NSString *rel) {
    if (!rel.length || [rel hasPrefix:@"/"]) return nil;
    for (NSString *part in [rel componentsSeparatedByString:@"/"])
        if ([part isEqualToString:@".."]) return nil;
    return [HBDirectory() URLByAppendingPathComponent:rel];
}

#pragma mark - registry

NSMutableArray<NSMutableDictionary *> *HBLoadRegistry(void) {
    NSData *data = [NSData dataWithContentsOfURL:HBResolve(@"registry.json")];
    NSMutableArray *arr = data ? [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingMutableContainers error:nil] : nil;
    return [arr isKindOfClass:[NSMutableArray class]] ? arr : [NSMutableArray array];
}

void HBSaveRegistry(NSArray *registry) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:registry options:0 error:nil];
    [data writeToURL:HBResolve(@"registry.json") atomically:YES];
}

#pragma mark - helpers

static NSString *Sanitize(NSString *s) {
    NSMutableString *out = [NSMutableString string];
    for (NSUInteger i = 0; i < s.length; i++) {
        unichar c = [[s lowercaseString] characterAtIndex:i];
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.') [out appendFormat:@"%C", c];
        else if (c == ' ') [out appendString:@"-"];
    }
    while ([out hasPrefix:@"."]) [out deleteCharactersInRange:NSMakeRange(0, 1)];
    return out.length ? out : nil;
}

static NSString *ShortHash(NSString *s) {
    unsigned char d[CC_SHA256_DIGEST_LENGTH];
    NSData *in = [s dataUsingEncoding:NSUTF8StringEncoding];
    CC_SHA256(in.bytes, (CC_LONG)in.length, d);
    return [NSString stringWithFormat:@"%02x%02x%02x%02x", d[0], d[1], d[2], d[3]];
}

static void Fetch(NSURL *url, void (^cb)(NSData *data, NSError *err)) {
    NSURLRequest *req = [NSURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:20];
    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *d, NSURLResponse *r, NSError *e) {
        NSInteger code = [r isKindOfClass:[NSHTTPURLResponse class]] ? ((NSHTTPURLResponse *)r).statusCode : 0;
        if (!e && (code < 200 || code >= 300 || !d.length)) e = HBError([NSString stringWithFormat:@"HTTP %ld from %@", (long)code, url.host]);
        cb(e ? nil : d, e);
    }] resume];
}

static void Upsert(NSString *type, NSString *ident, NSString *url) {
    NSMutableArray *reg = HBLoadRegistry();
    for (NSMutableDictionary *e in reg)
        if ([e[@"type"] isEqual:type] && [e[@"id"] isEqual:ident]) { e[@"url"] = url; HBSaveRegistry(reg); return; }
    [reg addObject:[@{@"type": type, @"id": ident, @"url": url, @"enabled": @YES} mutableCopy]];
    HBSaveRegistry(reg);
}

static NSURL *ParseURL(NSString *s) {
    s = [s stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    NSURL *u = [NSURL URLWithString:s];
    return ([u.scheme isEqualToString:@"https"] || [u.scheme isEqualToString:@"http"]) && u.host ? u : nil;
}

#pragma mark - install

void HBInstallPlugin(NSString *input, HBResult done) {
    NSURL *url = ParseURL(input);
    if (!url) return done(nil, HBError(@"Invalid URL"));

    NSString *last = url.lastPathComponent;
    NSURL *indexURL, *manifestURL;
    if ([last hasSuffix:@".js"]) {                       // single-file plugin
        indexURL = url; manifestURL = nil;
    } else if ([last hasSuffix:@".json"]) {              // manifest URL
        manifestURL = url; indexURL = [url URLByDeletingLastPathComponent];
    } else {                                             // folder URL
        NSURL *base = [input hasSuffix:@"/"] ? url : [url URLByAppendingPathComponent:@"" isDirectory:YES];
        manifestURL = [base URLByAppendingPathComponent:@"manifest.json"];
        indexURL = [base URLByAppendingPathComponent:@"index.js"];
    }

    void (^finish)(NSDictionary *, NSURL *) = ^(NSDictionary *manifest, NSURL *scriptURL) {
        Fetch(scriptURL, ^(NSData *js, NSError *err) {
            if (err) return done(nil, err);
            NSString *name = [manifest[@"name"] isKindOfClass:[NSString class]] ? manifest[@"name"] : nil;
            NSString *ident = Sanitize([manifest[@"id"] isKindOfClass:[NSString class]] ? manifest[@"id"] : (name ?: @""));
            if (!ident) ident = Sanitize([[scriptURL.lastPathComponent stringByDeletingPathExtension] stringByAppendingFormat:@"-%@", ShortHash(scriptURL.absoluteString)]);
            NSString *base = [@"plugins/" stringByAppendingString:ident];
            NSURL *dir = HBResolve(base);
            [[NSFileManager defaultManager] createDirectoryAtURL:dir withIntermediateDirectories:YES attributes:nil error:nil];
            [js writeToURL:HBResolve([base stringByAppendingString:@"/index.js"]) atomically:YES];
            NSMutableDictionary *m = [manifest mutableCopy] ?: [NSMutableDictionary dictionary];
            if (!m[@"name"]) m[@"name"] = ident;
            [[NSJSONSerialization dataWithJSONObject:m options:0 error:nil] writeToURL:HBResolve([base stringByAppendingString:@"/manifest.json"]) atomically:YES];
            Upsert(@"plugin", ident, input);
            done([NSString stringWithFormat:@"Installed “%@”", m[@"name"]], nil);
        });
    };

    if (!manifestURL) return finish(@{}, indexURL);
    Fetch(manifestURL, ^(NSData *d, NSError *e) {
        NSDictionary *manifest = d ? [NSJSONSerialization JSONObjectWithData:d options:0 error:nil] : nil;
        if (![manifest isKindOfClass:[NSDictionary class]]) manifest = @{};   // manifest is optional
        NSURL *script = indexURL;
        if ([last hasSuffix:@".json"]) {
            NSString *main = [manifest[@"main"] isKindOfClass:[NSString class]] ? manifest[@"main"] : @"index.js";
            script = [NSURL URLWithString:main relativeToURL:manifestURL].absoluteURL;
        }
        finish(manifest, script);
    });
}

void HBInstallTheme(NSString *input, HBResult done) {
    NSURL *url = ParseURL(input);
    if (!url) return done(nil, HBError(@"Invalid URL"));
    Fetch(url, ^(NSData *d, NSError *err) {
        if (err) return done(nil, err);
        NSDictionary *theme = [NSJSONSerialization JSONObjectWithData:d options:0 error:nil];
        if (![theme isKindOfClass:[NSDictionary class]] || !([theme[@"semanticColors"] isKindOfClass:[NSDictionary class]] || [theme[@"rawColors"] isKindOfClass:[NSDictionary class]]))
            return done(nil, HBError(@"Not a Heartblade theme (needs semanticColors or rawColors)"));
        NSString *name = [theme[@"name"] isKindOfClass:[NSString class]] ? theme[@"name"] : @"theme";
        NSString *ident = Sanitize(name) ?: ShortHash(input);
        [[NSFileManager defaultManager] createDirectoryAtURL:HBResolve(@"themes") withIntermediateDirectories:YES attributes:nil error:nil];
        [d writeToURL:HBResolve([NSString stringWithFormat:@"themes/%@.json", ident]) atomically:YES];
        Upsert(@"theme", ident, input);
        HBSetEnabled(@"theme", ident, YES);
        done([NSString stringWithFormat:@"Installed “%@”", name], nil);
    });
}

void HBSetEnabled(NSString *type, NSString *ident, BOOL enabled) {
    NSMutableArray *reg = HBLoadRegistry();
    for (NSMutableDictionary *e in reg) {
        if (![e[@"type"] isEqual:type]) continue;
        if ([e[@"id"] isEqual:ident]) e[@"enabled"] = @(enabled);
        else if ([type isEqual:@"theme"] && enabled) e[@"enabled"] = @NO;   // one active theme
    }
    HBSaveRegistry(reg);
}

void HBRemove(NSString *type, NSString *ident) {
    NSMutableArray *reg = HBLoadRegistry();
    NSMutableArray *keep = [NSMutableArray array];
    for (NSDictionary *e in reg) if (!([e[@"type"] isEqual:type] && [e[@"id"] isEqual:ident])) [keep addObject:e];
    HBSaveRegistry(keep);
    NSFileManager *fm = NSFileManager.defaultManager;
    if ([type isEqual:@"plugin"]) {
        [fm removeItemAtURL:HBResolve([@"plugins/" stringByAppendingString:ident]) error:nil];
        [fm removeItemAtURL:HBResolve([NSString stringWithFormat:@"data/%@.json", ident]) error:nil];
    } else {
        [fm removeItemAtURL:HBResolve([NSString stringWithFormat:@"themes/%@.json", ident]) error:nil];
    }
}

#pragma mark - client bundle

NSString *HBDevURL(void) { return [NSUserDefaults.standardUserDefaults stringForKey:kDevURLKey]; }
void HBSetDevURL(NSString *url) {
    if (url.length) [NSUserDefaults.standardUserDefaults setObject:url forKey:kDevURLKey];
    else [NSUserDefaults.standardUserDefaults removeObjectForKey:kDevURLKey];
}

NSURL *HBBundleSourceURL(void) {
    NSString *dev = HBDevURL();
    return ParseURL(dev ?: @"") ?: [NSURL URLWithString:HB_BUNDLE_URL];
}

void HBDownloadBundle(BOOL force, void (^done)(BOOL)) {
    NSURL *target = HBResolve(@"bundle.js"), *etagFile = HBResolve(@"bundle.etag");
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:HBBundleSourceURL()
                                                       cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:15];
    NSString *etag = [NSString stringWithContentsOfURL:etagFile encoding:NSUTF8StringEncoding error:nil];
    if (!force && etag && [NSFileManager.defaultManager fileExistsAtPath:target.path]) [req setValue:etag forHTTPHeaderField:@"If-None-Match"];

    [[NSURLSession.sharedSession dataTaskWithRequest:req completionHandler:^(NSData *d, NSURLResponse *r, NSError *e) {
        NSHTTPURLResponse *http = [r isKindOfClass:[NSHTTPURLResponse class]] ? (NSHTTPURLResponse *)r : nil;
        BOOL ok = !e && http.statusCode == 200 && d.length > 0;
        if (ok) {
            [d writeToURL:target atomically:YES];
            NSString *tag = http.allHeaderFields[@"Etag"] ?: http.allHeaderFields[@"ETag"];
            if (tag) [tag writeToURL:etagFile atomically:YES encoding:NSUTF8StringEncoding error:nil];
            else [NSFileManager.defaultManager removeItemAtURL:etagFile error:nil];
        }
        if (done) done(ok);
    }] resume];
}

BOOL HBFetchBundleSync(NSTimeInterval timeout) {
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block BOOL ok = NO;
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:HBBundleSourceURL()
                                                       cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:timeout];
    [[NSURLSession.sharedSession dataTaskWithRequest:req completionHandler:^(NSData *d, NSURLResponse *r, NSError *e) {
        NSInteger code = [r isKindOfClass:[NSHTTPURLResponse class]] ? ((NSHTTPURLResponse *)r).statusCode : 0;
        if (!e && code == 200 && d.length) { [d writeToURL:HBResolve(@"bundle.js") atomically:YES]; ok = YES; }
        dispatch_semaphore_signal(sem);
    }] resume];
    dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)((timeout + 1) * NSEC_PER_SEC)));
    return ok;
}

#pragma mark - diagnostics

BOOL HBSettingsEntryActive = NO;
static NSMutableArray<NSString *> *gLog;
static NSString *gInfo;

void HBLog(NSString *line) {
    @synchronized (NSObject.class) {
        if (!gLog) gLog = [NSMutableArray array];
        static NSDateFormatter *f; if (!f) { f = [NSDateFormatter new]; f.dateFormat = @"HH:mm:ss"; }
        [gLog addObject:[NSString stringWithFormat:@"%@ %@", [f stringFromDate:NSDate.date], line]];
        if (gLog.count > 400) [gLog removeObjectsInRange:NSMakeRange(0, gLog.count - 400)];
    }
}
NSArray<NSString *> *HBLogLines(void) { @synchronized (NSObject.class) { return [gLog copy] ?: @[]; } }
void HBSetInfo(NSString *json) { @synchronized (NSObject.class) { gInfo = [json copy]; } }

BOOL HBShakeEnabled(void) {
    id v = [NSUserDefaults.standardUserDefaults objectForKey:@"dev.heartblade.shake"];
    return v ? [v boolValue] : YES;
}
void HBSetShakeEnabled(BOOL on) { [NSUserDefaults.standardUserDefaults setBool:on forKey:@"dev.heartblade.shake"]; }

NSString *HBDebugReport(void) {
    NSBundle *b = NSBundle.mainBundle;
    NSData *bundle = [NSData dataWithContentsOfURL:HBResolve(@"bundle.js")];
    NSMutableString *r = [NSMutableString string];
    [r appendFormat:@"HeartBlade tweak %@\n", HB_VERSION];
    [r appendFormat:@"Discord %@ (%@)\n", b.infoDictionary[@"CFBundleShortVersionString"], b.infoDictionary[@"CFBundleVersion"]];
    [r appendFormat:@"iOS %@, new arch flag: %@\n", UIDevice.currentDevice.systemVersion, b.infoDictionary[@"RCTNewArchEnabled"] ?: @"(none)"];
    [r appendFormat:@"client bundle: %lu bytes, source: %@\n", (unsigned long)bundle.length, HBBundleSourceURL()];
    [r appendFormat:@"settings row active: %@, shake: %@\n", HBSettingsEntryActive ? @"yes" : @"no", HBShakeEnabled() ? @"on" : @"off"];
    NSData *reg = [NSJSONSerialization dataWithJSONObject:HBLoadRegistry() options:0 error:nil];
    [r appendFormat:@"registry: %@\n", reg ? [[NSString alloc] initWithData:reg encoding:NSUTF8StringEncoding] : @"[]"];
    @synchronized (NSObject.class) { [r appendFormat:@"client info: %@\n", gInfo ?: @"(client did not report)"]; }
    [r appendString:@"\n--- log ---\n"];
    NSArray *lines = HBLogLines();
    NSUInteger from = lines.count > 150 ? lines.count - 150 : 0;
    for (NSUInteger i = from; i < lines.count; i++) [r appendFormat:@"%@\n", lines[i]];
    BOOL HBClientEnabled(void) {
    id v = [NSUserDefaults.standardUserDefaults objectForKey:@"dev.heartblade.client"];
    return v ? [v boolValue] : YES;
}
void HBSetClientEnabled(BOOL on) { [NSUserDefaults.standardUserDefaults setBool:on forKey:@"dev.heartblade.client"]; }
    return r;
}

// Heartblade on-disk state: <Documents>/Heartblade/
//   bundle.js            JS client (downloaded)
//   registry.json        [{type,id,url,enabled}]
//   plugins/<id>/{manifest.json,index.js}
//   themes/<id>.json
//   data/<id>.json       per-plugin storage (written by JS)
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

#ifdef __cplusplus
extern "C" {
#endif

typedef void (^HBResult)(NSString *_Nullable message, NSError *_Nullable error);

NSURL *HBDirectory(void);
NSURL *_Nullable HBResolve(NSString *relativePath);   // nil when the path escapes the directory

NSMutableArray<NSMutableDictionary *> *HBLoadRegistry(void);
void HBSaveRegistry(NSArray *registry);

void HBInstallPlugin(NSString *url, HBResult done);
void HBInstallTheme(NSString *url, HBResult done);
void HBSetEnabled(NSString *type, NSString *identifier, BOOL enabled);
void HBRemove(NSString *type, NSString *identifier);

// Client bundle
NSString *_Nullable HBDevURL(void);
void HBSetDevURL(NSString *_Nullable url);
NSURL *HBBundleSourceURL(void);
void HBDownloadBundle(BOOL forceFresh, void (^_Nullable done)(BOOL updated));
BOOL HBFetchBundleSync(NSTimeInterval timeout);        // dev-server convenience

// Diagnostics
void HBLog(NSString *line);
NSArray<NSString *> *HBLogLines(void);
void HBSetInfo(NSString *json);              // pushed by the JS client at boot
NSString *HBDebugReport(void);

// Shake gesture fallback (turned off automatically once the Discord settings row works)
BOOL HBShakeEnabled(void);
void HBSetShakeEnabled(BOOL on);
extern BOOL HBSettingsEntryActive;

BOOL HBClientEnabled(void);
void HBSetClientEnabled(BOOL on);

#ifdef __cplusplus
}
#endif

NS_ASSUME_NONNULL_END

#import "Panel.h"
#import "Store.h"

static UIColor *HBAccent(void) { return [UIColor colorWithRed:0.89 green:0.16 blue:0.27 alpha:1]; }

static UIViewController *TopViewController(void) {
    UIWindow *win = nil;
    for (UIScene *sc in UIApplication.sharedApplication.connectedScenes) {
        if (![sc isKindOfClass:[UIWindowScene class]]) continue;
        for (UIWindow *w in ((UIWindowScene *)sc).windows) if (w.isKeyWindow) { win = w; break; }
        if (win) break;
    }
    UIViewController *vc = win.rootViewController;
    while (vc.presentedViewController) vc = vc.presentedViewController;
    return vc;
}

static void Alert(UIViewController *from, NSString *title, NSString *msg) {
    UIAlertController *a = [UIAlertController alertControllerWithTitle:title message:msg preferredStyle:UIAlertControllerStyleAlert];
    [a addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
    [from presentViewController:a animated:YES completion:nil];
}

typedef NS_ENUM(NSInteger, HBPage) { HBPageRoot, HBPagePlugins, HBPageThemes, HBPageDeveloper, HBPageLogs };

@interface HBPanel : UITableViewController
@property (nonatomic) HBPage page;
- (instancetype)initWithPage:(HBPage)page;
@end

@implementation HBPanel {
    NSArray<NSDictionary *> *_items;   // registry entries for plugin/theme pages
    NSArray<NSString *> *_logLines;
}

- (instancetype)initWithPage:(HBPage)page {
    if ((self = [super initWithStyle:UITableViewStyleInsetGrouped])) _page = page;
    return self;
}

- (void)viewDidLoad {
    [super viewDidLoad];
    self.title = @[@"HeartBlade", @"Plugins", @"Themes", @"Developer", @"Logs"][self.page];
    self.view.tintColor = HBAccent();
    if (self.page == HBPageRoot)
        self.navigationItem.rightBarButtonItem = [[UIBarButtonItem alloc] initWithBarButtonSystemItem:UIBarButtonSystemItemDone target:self action:@selector(close)];
    if (self.page == HBPageLogs)
        self.navigationItem.rightBarButtonItem = [[UIBarButtonItem alloc] initWithTitle:@"Copy report" style:UIBarButtonItemStylePlain target:self action:@selector(copyReport)];
    [self reload];
}

- (void)viewWillAppear:(BOOL)animated { [super viewWillAppear:animated]; [self reload]; }
- (void)close { [self dismissViewControllerAnimated:YES completion:nil]; }

- (void)copyReport {
    UIPasteboard.generalPasteboard.string = HBDebugReport();
    Alert(self, @"Copied", @"The debug report is on your clipboard.");
}

- (void)reload {
    if (self.page == HBPagePlugins || self.page == HBPageThemes) {
        NSString *type = self.page == HBPagePlugins ? @"plugin" : @"theme";
        NSMutableArray *m = [NSMutableArray array];
        for (NSDictionary *e in HBLoadRegistry()) if ([e[@"type"] isEqual:type]) [m addObject:e];
        _items = m;
    }
    if (self.page == HBPageLogs) _logLines = [[HBLogLines() reverseObjectEnumerator] allObjects];
    [self.tableView reloadData];
}

#pragma mark data source

- (NSInteger)tableView:(UITableView *)tv numberOfRowsInSection:(NSInteger)s {
    switch (self.page) {
        case HBPageRoot: return 3;
        case HBPagePlugins: case HBPageThemes: return _items.count + 1;
        case HBPageDeveloper: return s == 0 ? 3 : 3;
        case HBPageLogs: return MAX(_logLines.count, 1);
    }
}
- (NSInteger)numberOfSectionsInTableView:(UITableView *)tv { return self.page == HBPageDeveloper ? 2 : 1; }

- (NSString *)tableView:(UITableView *)tv titleForFooterInSection:(NSInteger)s {
    if (self.page == HBPageRoot) return [NSString stringWithFormat:@"HeartBlade %@", HB_VERSION];
    if (self.page == HBPagePlugins || self.page == HBPageThemes) return @"Changes apply after you restart Discord.";
    if (self.page == HBPageDeveloper && s == 0) return HBSettingsEntryActive ? nil : @"The Discord settings entry is not active, so shaking the phone opens this panel.";
    return nil;
}
- (NSString *)tableView:(UITableView *)tv titleForHeaderInSection:(NSInteger)s {
    return self.page == HBPageDeveloper ? @[@"Client", @"Diagnostics"][s] : nil;
}

- (UITableViewCell *)cell:(NSString *)title detail:(NSString *)detail chevron:(BOOL)chevron color:(UIColor *)color {
    UITableViewCell *c = [[UITableViewCell alloc] initWithStyle:UITableViewCellStyleValue1 reuseIdentifier:nil];
    c.textLabel.text = title;
    c.textLabel.textColor = color ?: UIColor.labelColor;
    c.detailTextLabel.text = detail;
    if (chevron) c.accessoryType = UITableViewCellAccessoryDisclosureIndicator;
    return c;
}

- (UITableViewCell *)tableView:(UITableView *)tv cellForRowAtIndexPath:(NSIndexPath *)ip {
    switch (self.page) {
        case HBPageRoot: {
            NSArray *names = @[@"Plugins", @"Themes", @"Developer"];
            return [self cell:names[ip.row] detail:nil chevron:YES color:nil];
        }
        case HBPagePlugins: case HBPageThemes: {
            if (ip.row == (NSInteger)_items.count)
                return [self cell:self.page == HBPagePlugins ? @"Add plugin from URL…" : @"Add theme from URL…" detail:nil chevron:NO color:HBAccent()];
            NSDictionary *e = _items[ip.row];
            UITableViewCell *c = [[UITableViewCell alloc] initWithStyle:UITableViewCellStyleSubtitle reuseIdentifier:nil];
            c.textLabel.text = e[@"id"];
            c.detailTextLabel.text = e[@"url"];
            c.detailTextLabel.textColor = UIColor.secondaryLabelColor;
            c.selectionStyle = UITableViewCellSelectionStyleNone;
            UISwitch *sw = [UISwitch new];
            sw.on = [e[@"enabled"] boolValue]; sw.onTintColor = HBAccent(); sw.tag = ip.row;
            [sw addTarget:self action:@selector(toggled:) forControlEvents:UIControlEventValueChanged];
            c.accessoryView = sw;
            return c;
        }
        case HBPageDeveloper: {
            if (ip.section == 0) {
                if (ip.row == 0) return [self cell:@"Update client now" detail:nil chevron:NO color:HBAccent()];
                if (ip.row == 1) return [self cell:@"Developer bundle URL" detail:HBDevURL() ?: @"off" chevron:NO color:nil];
                UITableViewCell *c = [self cell:@"Shake to open panel" detail:nil chevron:NO color:nil];
                UISwitch *sw = [UISwitch new]; sw.on = HBShakeEnabled(); sw.onTintColor = HBAccent();
                [sw addTarget:self action:@selector(shakeToggled:) forControlEvents:UIControlEventValueChanged];
                c.accessoryView = sw; c.selectionStyle = UITableViewCellSelectionStyleNone;
                return c;
            }
            NSArray *t = @[@"View logs", @"Copy debug report", @"Restart Discord"];
            return [self cell:t[ip.row] detail:nil chevron:ip.row == 0 color:ip.row == 0 ? nil : HBAccent()];
        }
        case HBPageLogs: {
            UITableViewCell *c = [[UITableViewCell alloc] initWithStyle:UITableViewCellStyleDefault reuseIdentifier:nil];
            c.textLabel.numberOfLines = 0;
            c.textLabel.font = [UIFont monospacedSystemFontOfSize:11 weight:UIFontWeightRegular];
            c.textLabel.text = _logLines.count ? _logLines[ip.row] : @"No log lines yet.";
            c.selectionStyle = UITableViewCellSelectionStyleNone;
            return c;
        }
    }
}

#pragma mark actions

- (void)toggled:(UISwitch *)sw {
    NSDictionary *e = _items[sw.tag];
    HBSetEnabled(e[@"type"], e[@"id"], sw.on);
    [self reload];
}
- (void)shakeToggled:(UISwitch *)sw { HBSetShakeEnabled(sw.on); }

- (BOOL)tableView:(UITableView *)tv canEditRowAtIndexPath:(NSIndexPath *)ip {
    return (self.page == HBPagePlugins || self.page == HBPageThemes) && ip.row < (NSInteger)_items.count;
}
- (void)tableView:(UITableView *)tv commitEditingStyle:(UITableViewCellEditingStyle)style forRowAtIndexPath:(NSIndexPath *)ip {
    if (style != UITableViewCellEditingStyleDelete) return;
    NSDictionary *e = _items[ip.row];
    HBRemove(e[@"type"], e[@"id"]);
    [self reload];
}

- (void)tableView:(UITableView *)tv didSelectRowAtIndexPath:(NSIndexPath *)ip {
    [tv deselectRowAtIndexPath:ip animated:YES];
    switch (self.page) {
        case HBPageRoot:
            [self.navigationController pushViewController:[[HBPanel alloc] initWithPage:(HBPage)(ip.row + 1)] animated:YES];
            break;
        case HBPagePlugins:
            if (ip.row == (NSInteger)_items.count)
                [self promptURL:@"Add plugin" message:@"Plugins run with full access to your Discord session. Only install code you trust." placeholder:@"https://…/my-plugin/" install:HBInstallPlugin];
            break;
        case HBPageThemes:
            if (ip.row == (NSInteger)_items.count)
                [self promptURL:@"Add theme" message:@"Paste the link to a theme (.json)." placeholder:@"https://…/theme.json" install:HBInstallTheme];
            break;
        case HBPageDeveloper: [self developerRow:ip]; break;
        case HBPageLogs: break;
    }
}

- (void)developerRow:(NSIndexPath *)ip {
    if (ip.section == 0 && ip.row == 0) {
        HBDownloadBundle(YES, ^(BOOL ok) { dispatch_async(dispatch_get_main_queue(), ^{
            Alert(self, ok ? @"Client updated" : @"Update failed", ok ? @"Restart Discord to use it." : @"Could not download the client bundle.");
        }); });
    } else if (ip.section == 0 && ip.row == 1) {
        UIAlertController *a = [UIAlertController alertControllerWithTitle:@"Developer bundle URL" message:@"Load heartblade.js from this URL on every launch, e.g. http://192.168.1.5:3000/heartblade.js. Leave empty to use the release build." preferredStyle:UIAlertControllerStyleAlert];
        [a addTextFieldWithConfigurationHandler:^(UITextField *f) { f.text = HBDevURL(); f.keyboardType = UIKeyboardTypeURL; f.autocapitalizationType = UITextAutocapitalizationTypeNone; }];
        [a addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
        [a addAction:[UIAlertAction actionWithTitle:@"Save" style:UIAlertActionStyleDefault handler:^(UIAlertAction *x) { HBSetDevURL(a.textFields.firstObject.text); [self.tableView reloadData]; }]];
        [self presentViewController:a animated:YES completion:nil];
    } else if (ip.section == 1) {
        if (ip.row == 0) [self.navigationController pushViewController:[[HBPanel alloc] initWithPage:HBPageLogs] animated:YES];
        else if (ip.row == 1) [self copyReport];
        else exit(0);
    }
}

- (void)promptURL:(NSString *)title message:(NSString *)msg placeholder:(NSString *)ph install:(void (*)(NSString *, HBResult))install {
    UIAlertController *a = [UIAlertController alertControllerWithTitle:title message:msg preferredStyle:UIAlertControllerStyleAlert];
    [a addTextFieldWithConfigurationHandler:^(UITextField *f) {
        f.placeholder = ph; f.keyboardType = UIKeyboardTypeURL; f.autocapitalizationType = UITextAutocapitalizationTypeNone; f.autocorrectionType = UITextAutocorrectionTypeNo;
        NSString *clip = UIPasteboard.generalPasteboard.string;
        if ([clip hasPrefix:@"http"]) f.text = clip;
    }];
    [a addAction:[UIAlertAction actionWithTitle:@"Cancel" style:UIAlertActionStyleCancel handler:nil]];
    [a addAction:[UIAlertAction actionWithTitle:@"Install" style:UIAlertActionStyleDefault handler:^(UIAlertAction *x) {
        install(a.textFields.firstObject.text, ^(NSString *m, NSError *e) { dispatch_async(dispatch_get_main_queue(), ^{
            if (e) { HBLog([@"ERROR install: " stringByAppendingString:e.localizedDescription]); Alert(self, @"Install failed", e.localizedDescription); return; }
            [self reload];
            Alert(self, m, @"Restart Discord to apply.");
        }); });
    }]];
    [self presentViewController:a animated:YES completion:nil];
}
@end

void HBShowPanel(void) {
    UIViewController *top = TopViewController();
    if (!top) return;
    if ([top isKindOfClass:[UINavigationController class]] && [((UINavigationController *)top).viewControllers.firstObject isKindOfClass:[HBPanel class]]) return;
    UINavigationController *nav = [[UINavigationController alloc] initWithRootViewController:[[HBPanel alloc] initWithPage:HBPageRoot]];
    [top presentViewController:nav animated:YES completion:nil];
}

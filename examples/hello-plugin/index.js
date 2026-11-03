// A plugin is a script body: it receives `hb` and returns { onLoad, onUnload }.
return {
  onLoad() {
    hb.logger.log("hello from my first plugin");
    hb.ui.alert("Heartblade", "Hello plugin loaded");
  },
  onUnload() {
    hb.logger.log("bye");
  },
};

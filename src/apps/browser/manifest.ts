// The Browser app: the web in Claude Home's own chrome. On the tablet the pages are a native WebView
// placed over the content area (android/src/kiosk/BrowserView.java); on the PC (?device=mock) an iframe stands in.
export const manifest = { id: 'browser', name: 'Browser' } as const;

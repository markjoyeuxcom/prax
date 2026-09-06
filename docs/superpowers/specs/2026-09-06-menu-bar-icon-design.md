# Prax menu-bar template icon

The macOS tray currently marks the filled application icon as a template. macOS
uses the alpha channel as its mask, so the app icon's opaque rounded background
becomes the white square reported by the user.

Use a dedicated transparent, black diamond-and-lowercase-p mark derived from the
existing application icon. The committed SVG uses paths rather than a font; its
44×44 PNG is embedded at compile time with Tauri's `include_image!`. Keep macOS
template rendering for contrast against the current menu-bar background. Keep
the full-colour app icon for the Dock and non-macOS system trays.

Regression evidence must inspect the actual embedded image: most pixels are
transparent, the mark is visible and black, and the bitmap is small enough for
menu-bar use. Build and exercise the native shell; preserve its menu actions and
the user's live data. Apple Developer ID signing/notarization is outside the
user's requested scope.

References:
- [Apple template-image contract](https://developer.apple.com/documentation/appkit/nsimage/istemplate)
- [Tauri compile-time images](https://docs.rs/tauri/latest/tauri/macro.include_image.html)

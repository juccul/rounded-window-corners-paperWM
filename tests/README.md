# PaperWM regression checks

Run `npm ci && npm run check && npm test` with Node.js 22 or newer. The tests
load the production TypeScript modules in an isolated VM with GObject/Clutter
test doubles. They check Wayland and XWayland surface geometry, monitor clipping,
clone shadow visibility and sizing, PaperWM's selection-child ordering, delayed
initialization, cancellation during disable, fullscreen transitions, and finite
shader uniforms for narrow windows and zero radius.

Blur My Shell regressions cover an inserted background preceding the actual
Mutter surface, both extension load orders, background destruction, surface
replacement, and blur visibility while PaperWM hides the real window for its
scrolling clone. The tests also check that deliberately hidden blur is preserved.

These tests do not render shaders. Compositor validation uses a separate
GNOME Shell 50.5 headless Wayland session and PaperWM 50.0.1, with temporary
XDG data/config directories and a separate D-Bus session. Keep these settings
isolated from the running desktop.

Check the following in a real session when changing the integration:

- Open decorated and undecorated Wayland and XWayland windows, plus a Qt or
  Electron app. Check all four corners and shadows at rest and while scrolling.
- Scroll partially offscreen and check that shadows do not bleed onto another
  monitor. Repeat across monitors with different scale factors.
- Change focus repeatedly. PaperWM's selection must remain the first child of
  its window clone container, and shadows must not duplicate.
- Resize narrow windows, enter/leave fullscreen, minimize/restore, and close
  windows during animations.
- Enter/leave overview and switch workspaces. Toggle the rounding extension and
  PaperWM in both orders, checking for leftover actors or JavaScript errors.

The development smoke test covered GTK Wayland/XWayland windows (including
undecorated windows), Chrome on Wayland, Qt6 on XWayland, and PaperWM's clone
scrolling with Blur My Shell 72 application blur on one virtual monitor.
Physical multi-monitor layouts, fractional scaling, and Electron-specific
client-side decoration variants still need desktop verification.

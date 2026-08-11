Typography
Font Family
font-family:
  Inter,
  "Segoe UI",
  Roboto,
  Helvetica,
  Arial,
  sans-serif;

Ưu tiên Inter.

Với dữ liệu kỹ thuật:

font-family:

  "SFMono-Regular",
  Consolas,
  monospace;

Dùng monospace cho:

IP address
UUID
CIDR
Hostname
Port
Resource ID
Log / command / technical value
Type Scale
Page Title
24px / 600
line-height: 32px

Section Title
18px / 600
line-height: 26px

Card / Panel Title
16px / 600
line-height: 24px

Body
14px / 400
line-height: 20px

Body Medium
14px / 500
line-height: 20px

Table Header
13px / 600
line-height: 18px

Table Body
13px / 400
line-height: 20px

Label
13px / 500
line-height: 18px

Secondary Text
12px / 400
line-height: 18px

Sidebar Item
14px / 500

Sidebar Group Label
11px / 600
uppercase
letter-spacing: 0.06em

Technical / Monospace
12-13px / 400
Font Weight

Chỉ nên dùng:

400 → normal content
500 → labels / navigation / buttons
600 → titles / important headings

Hạn chế 700+.

Text Colors
--text-primary: #1F2937;
--text-secondary: #6B7280;
--text-muted: #9CA3AF;
--text-disabled: #BFC5CE;

Sidebar:

--sidebar-text: #CBD5E1;
--sidebar-text-active: #FFFFFF;
--sidebar-label: #7F8EA3;

Implementation notes
--------------------

- The dashboard uses Inter as the application and heading font. JetBrains Mono
  remains the technical font for IDs, hostnames, ports, resource IDs, logs, and
  commands.
- The existing AURORA dark shell is retained because this document defines
  typography and text tokens but does not define a light/dark surface system.
  The light text tokens above are available for a future light theme; the dark
  theme provides its accessible foreground overrides.
- shadcn/ui owns interaction primitives and focus states. Application pages
  should use the generated components in `src/components/ui/` instead of
  introducing one-off button, badge, dialog, or navigation styles.
- Page titles, section titles, and labels are limited to weights 600/500 in the
  shell. Technical values must use the monospace token and must not be styled as
  scientific conclusions without a versioned backend contract.
- Spacing, surface/background colors, responsive breakpoints, empty states, and
  data visualization rules still need explicit design decisions before the
  feature pages are connected to live API data.

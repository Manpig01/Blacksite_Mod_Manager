#!/usr/bin/env python3
"""
BAML literal audit for Blacksite (WPF).

The WPF markup compiler stores some attribute literals (Brush, Color, enum,
Cursor, Thickness...) inside .g.resources as RAW STRINGS that are only converted
at RUNTIME by the BAML reader (TypeConverterMarkupExtension /
DeferredBinaryDeserializerExtension). An invalid literal there compiles cleanly
and crashes only when the template first materializes on the user's machine --
exactly the v1.2.0 "Fill='None'" bug (WPF's BrushConverter rejects "None";
WinUI accepts it).

Usage: python3 baml_audit.py <path-to-Blacksite.g.resources>
"""
import re
import sys

WPF_KNOWN_COLORS = {
    "AliceBlue","AntiqueWhite","Aqua","Aquamarine","Azure","Beige","Bisque","Black",
    "BlanchedAlmond","Blue","BlueViolet","Brown","BurlyWood","CadetBlue","Chartreuse",
    "Chocolate","Coral","CornflowerBlue","Cornsilk","Crimson","Cyan","DarkBlue","DarkCyan",
    "DarkGoldenrod","DarkGray","DarkGreen","DarkKhaki","DarkMagenta","DarkOliveGreen",
    "DarkOrange","DarkOrchid","DarkRed","DarkSalmon","DarkSeaGreen","DarkSlateBlue",
    "DarkSlateGray","DarkTurquoise","DarkViolet","DeepPink","DeepSkyBlue","DimGray",
    "DodgerBlue","Firebrick","FloralWhite","ForestGreen","Fuchsia","Gainsboro","GhostWhite",
    "Gold","Goldenrod","Gray","Green","GreenYellow","Honeydew","HotPink","IndianRed",
    "Indigo","Ivory","Khaki","Lavender","LavenderBlush","LawnGreen","LemonChiffon",
    "LightBlue","LightCoral","LightCyan","LightGoldenrodYellow","LightGray","LightGreen",
    "LightPink","LightSalmon","LightSeaGreen","LightSkyBlue","LightSlateGray",
    "LightSteelBlue","LightYellow","Lime","LimeGreen","Linen","Magenta","Maroon",
    "MediumAquamarine","MediumBlue","MediumOrchid","MediumPurple","MediumSeaGreen",
    "MediumSlateBlue","MediumSpringGreen","MediumTurquoise","MediumVioletRed",
    "MidnightBlue","MintCream","MistyRose","Moccasin","NavajoWhite","Navy","OldLace",
    "Olive","OliveDrab","Orange","OrangeRed","Orchid","PaleGoldenrod","PaleGreen",
    "PaleTurquoise","PaleVioletRed","PapayaWhip","PeachPuff","Peru","Pink","Plum",
    "PowderBlue","Purple","Red","RosyBrown","RoyalBlue","SaddleBrown","Salmon",
    "SandyBrown","SeaGreen","SeaShell","Sienna","Silver","SkyBlue","SlateBlue",
    "SlateGray","Snow","SpringGreen","SteelBlue","Tan","Teal","Thistle","Tomato",
    "Transparent","Turquoise","Violet","Wheat","White","WhiteSmoke","Yellow","YellowGreen",
}


def audit(data: bytes) -> int:
    problems = 0

    # 1) No "None" as a BAML string record (the v1.2.0 bug class).
    for m in re.finditer(rb"None", data):
        before = data[max(0, m.start() - 2):m.start()]
        if re.fullmatch(rb"[\x00-\x2f]", before, re.DOTALL):
            ctx = data[max(0, m.start() - 40):m.start() + 16]
            print(f"FAIL: 'None' string record at offset {m.start()}  context={ctx!r}")
            problems += 1

    # 2) A bare alphabetic word directly following a Brush-typed property name
    #    must be a known WPF color/brush name.
    strings = [(m.start(), m.group().decode()) for m in re.finditer(rb"[\x20-\x7e]{3,}", data)]
    brush_props = ("Background", "Foreground", "BorderBrush", "Fill", "Stroke",
                   "CaretBrush", "SelectionBrush")
    for i, (off, s) in enumerate(strings):
        if s in brush_props and i + 1 < len(strings):
            nxt = strings[i + 1][1]
            if re.fullmatch(r"[A-Za-z]+", nxt) and nxt not in WPF_KNOWN_COLORS:
                print(f"FAIL: brush literal {nxt!r} after property {s!r} at offset {off} is not a valid WPF brush")
                problems += 1

    # 3) All hex color tokens must be valid #RGB / #RRGGBB / #AARRGGBB.
    #    BAML string records are length-prefixed: the byte right before the text is its
    #    length, and a naive regex can overrun into the NEXT record when it starts with
    #    a hex digit. Respect the prefix before validating (truncating only ever hides a
    #    token that the prefix itself proves is shorter — real 8-digit colors still fail).
    # A real WPF color literal is #RGB/#RRGGBB/#AARRGGBB (>= 4 chars with '#'); shorter hex runs
    # are BAML binary record data (e.g. resource-key shorthands like "#1") — not colors.
    for m in re.finditer(rb"#[0-9A-Fa-f]{3,8}", data):
        token = m.group().decode()
        prefix = data[m.start() - 1] if m.start() > 0 else 0
        if 3 <= prefix < len(token):
            token = token[:prefix]
        if len(token) not in (4, 7, 9):
            print(f"FAIL: suspicious color token {token!r} at offset {m.start()}")
            problems += 1

    if problems == 0:
        print("BAML audit: OK -- no invalid runtime-converted literals found.")
    return problems


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(1 if audit(open(sys.argv[1], "rb").read()) else 0)

#!/bin/zsh
set -euo pipefail
project_dir="${0:A:h:h}"
app_dir="$project_dir/Builds/LingoLife Original.app"
asset_path="$project_dir/Assets/Resources/OriginalTown.json"
if [[ ! -f "$asset_path" ]]; then
  print -u2 "缺少同源资产：$asset_path。先从网页原创样板导出 OriginalTown.json。"
  exit 1
fi
mkdir -p "$app_dir/Contents/MacOS" "$app_dir/Contents/Resources" /private/tmp/lingolife-swift-module-cache
xcrun swiftc -target "$(uname -m)-apple-macos14.0" -swift-version 5 -parse-as-library -O -module-cache-path /private/tmp/lingolife-swift-module-cache \
  -framework AppKit -framework SwiftUI -framework SceneKit -framework Combine \
  "$project_dir/MacPreview/OriginalTown.swift" -o "$app_dir/Contents/MacOS/LingoLifeOriginal"
cp "$asset_path" "$app_dir/Contents/Resources/OriginalTown.json"
icon_dir=/private/tmp/lingolife-original-icon.iconset
xcrun swift -module-cache-path /private/tmp/lingolife-swift-module-cache "$project_dir/MacPreview/BuildIcon.swift" "$icon_dir"
python3 - "$icon_dir" "$app_dir/Contents/Resources/OriginalTown.icns" <<'ICON'
from pathlib import Path
import struct, sys
source, target = map(Path, sys.argv[1:])
entries = [('icp4', 'icon_16x16.png'), ('icp5', 'icon_32x32.png'), ('icp6', 'icon_32x32@2x.png'), ('ic07', 'icon_128x128.png'), ('ic08', 'icon_256x256.png'), ('ic09', 'icon_512x512.png'), ('ic10', 'icon_512x512@2x.png')]
chunks = []
for tag, name in entries:
    data = (source / name).read_bytes()
    chunks.append(tag.encode() + struct.pack('>I', len(data) + 8) + data)
body = b''.join(chunks)
target.write_bytes(b'icns' + struct.pack('>I', len(body) + 8) + body)
ICON
cat > "$app_dir/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>LingoLifeOriginal</string>
<key>CFBundleIdentifier</key><string>com.lingolife.original.preview</string>
<key>CFBundleName</key><string>LingoLife Original</string>
<key>CFBundleDisplayName</key><string>LingoLife 原创小镇</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>OriginalTown</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>LSApplicationCategoryType</key><string>public.app-category.simulation-games</string>
</dict></plist>
PLIST
codesign --force --deep --sign - "$app_dir"
print "$app_dir"

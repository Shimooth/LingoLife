#!/bin/zsh
set -euo pipefail
project_dir="${0:A:h:h}"
unity_editor="${UNITY_EDITOR_PATH:-/Applications/Unity/Hub/Editor/6000.5.8f1/Unity.app/Contents/MacOS/Unity}"
"$unity_editor" -batchmode -nographics -quit -projectPath "$project_dir" -executeMethod BuildOriginalPreview.MacOS -logFile /private/tmp/lingolife-original-unity-build.log

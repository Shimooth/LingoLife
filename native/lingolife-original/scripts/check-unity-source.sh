#!/bin/zsh
set -euo pipefail
project_dir="${0:A:h:h}"
unity_editor="${UNITY_EDITOR_PATH:-/Applications/Unity/Hub/Editor/6000.5.8f1/Unity.app/Contents/MacOS/Unity}"
unity_scripting="${unity_editor:h:h}/Resources/Scripting"
python3 - "$unity_scripting" "$project_dir" <<'PY'
from pathlib import Path
import sys
root, project = map(Path, sys.argv[1:])
refs = list((root / 'Managed/UnityEngine').glob('*.dll'))
refs.append(root / 'MonoBleedingEdge/lib/mono/4.5/Facades/netstandard.dll')
args = ['-nologo', '-target:library', '-out:/private/tmp/LingoLifeOriginalSourceCheck.dll']
args += ['-r:' + str(path) for path in refs]
args += [str(project / 'Assets/Scripts/OriginalTownPreview.cs'), str(project / 'Assets/Editor/BuildOriginalPreview.cs')]
Path('/private/tmp/lingolife-unity-source-check.rsp').write_text('\n'.join('"' + arg + '"' for arg in args))
PY
"$unity_scripting/MonoBleedingEdge/bin/mono" "$unity_scripting/MonoBleedingEdge/lib/mono/4.5/csc.exe" @/private/tmp/lingolife-unity-source-check.rsp
print "Unity 同源导入器和样板源码编译通过；此检查不代表 Editor / Player 构建成功。"

"""Local-only launcher. Never use for VPS/Compose; secrets remain untracked."""
import os
from pathlib import Path
import shlex
import sys

root = Path(__file__).resolve().parents[2]
if __name__ == '__main__':
    # Keep old local start commands working without silently running the app on
    # Apple's unsupported Python 3.9 / system SQLite combination.
    if sys.version_info < (3, 11):
        supported = root / 'backend/.runtime/.venv/bin/python'
        if supported.is_file():
            os.execv(str(supported), [str(supported), str(Path(__file__).resolve())])
        raise SystemExit('本地后端需要 Python 3.11 以上。请用新版 Python 创建虚拟环境并安装 backend[test]。')
    envfile = root / '.env'
    if envfile.is_file():
        for line in envfile.read_text().splitlines():
            key, separator, value = line.strip().removeprefix('export ').partition('=')
            if separator and key.strip().isidentifier():
                values = shlex.split(value, comments=True)
                if len(values) == 1:
                    os.environ.setdefault(key.strip(), values[0])
    os.environ['LINGOLIFE_ENV'] = 'development'
    os.environ['DATABASE_URL'] = 'sqlite:///' + str(root / 'backend/data/lingolife.db')
    os.environ['LINGOLIFE_CONFIG'] = str(root / 'config/lingolife.example.yaml')
    secret = root / '.env.local-auth'
    os.environ.pop('LINGOLIFE_LOCAL_MASTER_PASSWORD_HASH', None)
    if secret.is_file():
        os.environ['LINGOLIFE_LOCAL_MASTER_PASSWORD_HASH'] = secret.read_text().strip()
    os.chdir(root / 'backend')
    os.execv(sys.executable, [sys.executable, '-m', 'uvicorn', 'lingolife.app:app', '--reload', '--reload-dir', 'lingolife', '--timeout-graceful-shutdown', '10', '--host', '127.0.0.1', '--port', '8000'])

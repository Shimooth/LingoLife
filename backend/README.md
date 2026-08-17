# LingoLife Demo API

Python 3.11+：

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
uvicorn lingolife.app:app --reload
pytest
```

默认数据库是 `./data/lingolife.db`。生产环境通过 `LINGOLIFE_CONFIG` 指向 YAML，秘密仅通过 `DEEPSEEK_API_KEY` 和 `DATABASE_URL` 环境变量注入。未配置 DeepSeek 或调用失败时，API 自动使用安全的规则回复。

import os
import shutil
from pathlib import Path

Path("tests/fixtures/static").mkdir(parents=True, exist_ok=True)
if Path("tests/fixtures/sample.c").exists():
    shutil.move("tests/fixtures/sample.c", "tests/fixtures/static/vulnerable_c.c")
if Path("tests/fixtures/sample.cpp").exists():
    shutil.move("tests/fixtures/sample.cpp", "tests/fixtures/static/clean_c.c")
if Path("tests/fixtures/sample.go").exists():
    shutil.move("tests/fixtures/sample.go", "tests/fixtures/static/vulnerable_go.go")
if Path("tests/fixtures/sample.js").exists():
    shutil.move("tests/fixtures/sample.js", "tests/fixtures/static/vulnerable_js.js")

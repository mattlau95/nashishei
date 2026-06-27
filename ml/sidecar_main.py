import multiprocessing
import os
import sys

# Must run before importing main so insightface picks up the custom home dir.
if getattr(sys, 'frozen', False):
    os.environ.setdefault(
        'INSIGHTFACE_HOME',
        os.path.join(os.path.dirname(sys.executable), 'insightface_models'),
    )

import uvicorn  # noqa: E402
from main import app  # noqa: E402

if __name__ == '__main__':
    multiprocessing.freeze_support()  # required on Windows for frozen executables
    uvicorn.run(app, host='127.0.0.1', port=8001, log_level='warning')

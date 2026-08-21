"""
Local async job server for the Codex transcoder container (development only).

WHY THIS EXISTS
───────────────
runpod-python ships a local test server (`--rp_serve_api`), but its `/run`
route is a stub. From runpod 1.12.0, rp_fastapi.py:

    async def _sim_run(self, job_request):
        assigned_job_id = f"test-{uuid.uuid4()}"
        job_list.add({...})                                  # stash only
        return {"id": assigned_job_id, "status": "IN_PROGRESS"}

The handler is never invoked. Work happens only in `_sim_runsync` (blocks until
the transcode finishes) or `_sim_status` (same, on a later poll). That leaves no
good option for Codex:

  · POST /run     → dispatch "succeeds", nothing ever transcodes. Silent no-op.
  · POST /runsync → blocks for the whole transcode. But media-api dispatches
                    inside ctx.waitUntil() with AbortSignal.timeout(30_000), so
                    at t+30s the fetch aborts and dispatchRunPodJob() tries to
                    mark the media FAILED while the container is still working.

Production has neither problem, because RunPod's cloud `/run` queues the job and
returns in under a second. This server reproduces that contract locally: accept
the job, hand back an id immediately, do the work on a background thread, and
let the handler post its own completion webhook — exactly as in production. So
`RUNPOD_DIRECT_URL` uses the same `/run` path locally as in the cloud.

Access logging is left ON deliberately. With `--rp_serve_api` a request that
arrived and returned 200 produced no log line at all, which made a working
dispatch indistinguishable from one that never left the worker, and cost real
debugging hours.

See infrastructure/runpod/LOCAL_DEV.md.
"""

import os
import threading
import traceback
import uuid
from typing import Any

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse

# Import AFTER the module guard in main.py, so importing does not start
# runpod's serverless loop.
from handler.main import handler as transcode_handler

app = FastAPI(title="Codex local transcoder", docs_url=None, redoc_url=None)

# job_id → {"status": ..., "output": ..., "error": ...}
# In-memory and unbounded: this process is a dev container that gets restarted,
# and a handful of jobs per session is the realistic ceiling.
_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()


def _set(job_id: str, **fields: Any) -> None:
    with _jobs_lock:
        _jobs.setdefault(job_id, {}).update(fields)


def _run_job(job_id: str, job_input: dict[str, Any]) -> None:
    """Execute one job to completion on this thread.

    The handler posts its own success/failure webhook, so nothing here needs to
    notify media-api. We only record terminal state for GET /status/{job_id}.
    """
    _set(job_id, status="IN_PROGRESS")
    try:
        output = transcode_handler({"id": job_id, "input": job_input})
        # The handler returns {"status": "error", ...} for handled failures
        # rather than raising, so inspect the payload as well.
        failed = isinstance(output, dict) and output.get("status") == "error"
        _set(
            job_id,
            status="FAILED" if failed else "COMPLETED",
            output=output,
        )
        print(
            f"[local-server] job {job_id} {'FAILED' if failed else 'COMPLETED'}",
            flush=True,
        )
    except Exception as exc:  # noqa: BLE001 — a dev server must not die on one bad job
        _set(job_id, status="FAILED", error=str(exc))
        print(f"[local-server] job {job_id} raised: {exc}", flush=True)
        traceback.print_exc()


@app.post("/run")
async def run(payload: dict[str, Any]) -> JSONResponse:
    """Asynchronous dispatch — mirrors RunPod cloud POST /v2/{endpoint}/run."""
    job_input = payload.get("input")
    if not isinstance(job_input, dict):
        return JSONResponse({"error": 'body must be {"input": {...}}'}, status_code=400)

    job_id = f"local-{uuid.uuid4()}"
    _set(job_id, status="IN_QUEUE")
    threading.Thread(
        target=_run_job, args=(job_id, job_input), daemon=True, name=job_id
    ).start()

    print(f"[local-server] accepted job {job_id}", flush=True)
    return JSONResponse({"id": job_id, "status": "IN_PROGRESS"})


@app.post("/runsync")
async def runsync(payload: dict[str, Any]) -> JSONResponse:
    """Synchronous dispatch — for poking the handler by hand from a shell.

    Not for use by media-api: it blocks past the 30s dispatch timeout.
    """
    job_input = payload.get("input")
    if not isinstance(job_input, dict):
        return JSONResponse({"error": 'body must be {"input": {...}}'}, status_code=400)

    job_id = f"local-sync-{uuid.uuid4()}"
    _run_job(job_id, job_input)
    with _jobs_lock:
        record = dict(_jobs.get(job_id, {}))
    return JSONResponse({"id": job_id, **record})


@app.get("/status/{job_id}")
async def status(job_id: str) -> JSONResponse:
    with _jobs_lock:
        record = dict(_jobs.get(job_id, {}))
    if not record:
        return JSONResponse(
            {"id": job_id, "status": "FAILED", "error": "Job ID not found"},
            status_code=404,
        )
    return JSONResponse({"id": job_id, **record})


@app.get("/health")
async def health() -> dict[str, Any]:
    with _jobs_lock:
        running = sum(1 for j in _jobs.values() if j.get("status") == "IN_PROGRESS")
        total = len(_jobs)
    return {"status": "ok", "jobs_running": running, "jobs_seen": total}


if __name__ == "__main__":
    uvicorn.run(
        app,
        host=os.environ.get(
            "LOCAL_SERVER_HOST", "0.0.0.0"
        ),  # noqa: S104 — container-internal
        port=int(os.environ.get("LOCAL_SERVER_PORT", "8000")),
        access_log=True,
        log_level=os.environ.get("LOCAL_SERVER_LOG_LEVEL", "info"),
    )

"""
Analysis API routes — run analyses, view history, stream results.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..models import AnalysisRunRequest, AnalysisRunResponse, StatusResponse
from ..services import analysis_service as svc

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.post("/run", response_model=AnalysisRunResponse)
async def run_analysis(body: AnalysisRunRequest):
    """Start a new analysis. Stream progress via /stream/{id}."""
    try:
        run_id = await svc.start_analysis(
            ticker=body.ticker,
            analysis_date=body.analysis_date,
            analysis_type=body.analysis_type,
            analysis_depth=body.analysis_depth,
        )
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))

    status = await svc.get_analysis_status(run_id)
    return status


@router.get("/stream/{run_id}")
async def stream_analysis(run_id: int):
    """SSE stream of agent outputs as the analysis runs."""
    return StreamingResponse(
        svc.stream_analysis_events(run_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/status/{run_id}")
async def get_analysis_status(run_id: int):
    """Poll for analysis completion status."""
    result = await svc.get_analysis_status(run_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.get("/history")
async def get_analysis_history(
    page: int = 1,
    per_page: int = 20,
    ticker: str = "",
    type: str = "",
):
    """Get paginated analysis history. Filter by ticker and/or type."""
    return await svc.get_analysis_history(
        page=page,
        per_page=per_page,
        ticker_filter=ticker,
        type_filter=type,
    )


@router.get("/{run_id}")
async def get_analysis_detail(run_id: int):
    """Get full analysis detail with all agent outputs."""
    result = await svc.get_analysis_detail(run_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Analysis run not found")
    return result

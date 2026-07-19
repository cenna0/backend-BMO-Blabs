from typing import Annotated
import secrets

from fastapi import Header, HTTPException, Request, status


async def require_internal_token(
    request: Request,
    x_internal_service_token: Annotated[str | None, Header(alias="X-Internal-Service-Token")] = None,
) -> None:
    expected = request.app.state.settings.internal_service_token
    if not x_internal_service_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="MISSING_INTERNAL_SERVICE_TOKEN",
        )
    if not secrets.compare_digest(x_internal_service_token, expected):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="INVALID_INTERNAL_SERVICE_TOKEN",
        )

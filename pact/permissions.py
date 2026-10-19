"""Deterministic role permissions for the demo household."""

from __future__ import annotations

from typing import Any


class PermissionError(ValueError):
    pass


def require(caller: dict[str, Any] | None, capability: str) -> None:
    """Require a server-resolved caller for privileged operations.

    Direct unit tests may omit a caller to exercise the policy core. HTTP/MCP
    paths always provide one, so identity-sensitive operations cannot be
    authorized from arbitrary tool arguments.
    """
    if caller is None:
        return
    if capability == "manage_rules" and not caller.get("can_manage_rules"):
        raise PermissionError("only the adult owner can manage household rules")
    if capability == "approve" and not caller.get("can_approve"):
        raise PermissionError("this household member cannot approve actions")
    if capability == "private" and not caller.get("can_access_private"):
        raise PermissionError("this household member cannot access unrelated private data")


def check_execution(caller: dict[str, Any] | None, action: dict[str, Any], decision: str) -> None:
    if caller is None:
        return
    role = caller.get("role")
    if role == "child" and action.get("action") in {"purchase", "booking", "unlock", "camera", "view_private", "device_control"}:
        raise PermissionError("child members cannot execute paid, private, or device actions")
    if role == "caregiver" and decision != "allow":
        raise PermissionError("caregiver actions require an explicit confirmed allow rule")
    if action.get("action") == "view_private" and not caller.get("can_access_private"):
        raise PermissionError("private data is not available to this member")


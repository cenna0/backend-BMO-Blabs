from __future__ import annotations

from pathlib import Path
import json
import re


EXPECTED_PHRASES = {
    "short_greeting": "short",
    "reassuring_line": "short",
    "excited_line": "short",
    "calm_medium": "medium",
    "excited_medium": "medium",
    "names_numbers": "medium",
    "long_normal": "long",
    "continuous": "continuous",
}
SAFE_ID = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


class TextSetError(RuntimeError):
    pass


def load_phrases(path: Path) -> list[dict[str, str]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise TextSetError("comparison text is unreadable") from error
    if not isinstance(payload, dict) or payload.get("schema_version") != 1:
        raise TextSetError("invalid comparison text schema")
    phrases = payload.get("phrases")
    if not isinstance(phrases, list):
        raise TextSetError("comparison phrases must be an array")
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw_phrase in phrases:
        if not isinstance(raw_phrase, dict) or set(raw_phrase) != {"id", "class", "text"}:
            raise TextSetError("each phrase must have only id, class, and text")
        phrase_id = raw_phrase.get("id")
        phrase_class = raw_phrase.get("class")
        text = raw_phrase.get("text")
        if not isinstance(phrase_id, str) or not SAFE_ID.fullmatch(phrase_id):
            raise TextSetError("phrase id is unsafe")
        if phrase_id in seen:
            raise TextSetError("duplicate phrase id")
        if EXPECTED_PHRASES.get(phrase_id) != phrase_class:
            raise TextSetError("phrase id/class mapping is not canonical")
        if (
            not isinstance(text, str)
            or not text.strip()
            or len(text.encode("utf-8")) > 8192
            or any(ord(character) < 32 and character not in "\n\t" for character in text)
        ):
            raise TextSetError("phrase text is invalid")
        seen.add(phrase_id)
        result.append({"id": phrase_id, "class": phrase_class, "text": text})
    if seen != set(EXPECTED_PHRASES):
        raise TextSetError("comparison text set is incomplete")
    return result

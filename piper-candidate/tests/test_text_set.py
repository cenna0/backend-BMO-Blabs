import json

import pytest

from bmo_piper.text_set import TextSetError, load_phrases


PHRASES = [
    ("short_greeting", "short"),
    ("reassuring_line", "short"),
    ("excited_line", "short"),
    ("calm_medium", "medium"),
    ("excited_medium", "medium"),
    ("names_numbers", "medium"),
    ("long_normal", "long"),
    ("continuous", "continuous"),
]


def write_text_set(tmp_path, mutate=None):
    payload = {
        "schema_version": 1,
        "phrases": [
            {"id": phrase_id, "class": phrase_class, "text": f"Text for {phrase_id}."}
            for phrase_id, phrase_class in PHRASES
        ],
    }
    if mutate:
        mutate(payload)
    path = tmp_path / "comparison.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_load_phrases_accepts_exact_canonical_set(tmp_path):
    assert [item["id"] for item in load_phrases(write_text_set(tmp_path))] == [
        item[0] for item in PHRASES
    ]


@pytest.mark.parametrize(
    "mutate",
    [
        lambda payload: payload["phrases"].__setitem__(1, dict(payload["phrases"][0])),
        lambda payload: payload["phrases"][0].__setitem__("id", "../escape"),
        lambda payload: payload["phrases"][0].__setitem__("class", "continuous"),
        lambda payload: payload["phrases"][0].__setitem__("text", ""),
        lambda payload: payload["phrases"][0].__setitem__("text", 42),
    ],
)
def test_load_phrases_rejects_unsafe_or_noncanonical_input(tmp_path, mutate):
    with pytest.raises(TextSetError):
        load_phrases(write_text_set(tmp_path, mutate))

"""
llm_models.py
─────────────
DeepEvalBaseLLM wrappers for Groq and Ollama so they can be used as
DeepTeam's `simulator_model` and `evaluation_model` without requiring
an OpenAI API key.

Includes the full schema repair & JSON extraction engine from ollama.py
to eliminate DeepEval internal schema validation errors ("control character
found", missing metadata fields, unescaped quotes/newlines).
"""

import os
import re
import json
import asyncio
from typing import Any, Optional

from openai import OpenAI
from deepeval.models import DeepEvalBaseLLM
from src.config import settings


# ── Full Schema Repair & Robust JSON Parsing Engine ───────────────────────────

def _extract_json(text: str) -> str:
    """
    Best-effort cleanup of LLM output before JSON parsing:
    - strips ```json ... ``` / ``` ... ``` code fences
    - extracts balanced {...} or [...] blocks
    """
    text = text.strip()

    # Strip markdown code fences
    fence_match = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL)
    if fence_match:
        text = fence_match.group(1).strip()

    # If it's already valid JSON, return as-is
    try:
        json.loads(text)
        return text
    except json.JSONDecodeError:
        pass

    # Extract first balanced JSON structure
    for open_ch, close_ch in (("{", "}"), ("[", "]")):
        start = text.find(open_ch)
        if start == -1:
            continue
        depth = 0
        for i in range(start, len(text)):
            if text[i] == open_ch:
                depth += 1
            elif text[i] == close_ch:
                depth -= 1
                if depth == 0:
                    candidate = text[start:i + 1]
                    try:
                        json.loads(candidate)
                        return candidate
                    except json.JSONDecodeError:
                        return candidate
    return text


def _schema_field_names(schema) -> list[str]:
    fields = getattr(schema, "model_fields", None) or getattr(schema, "__fields__", None) or {}
    return list(fields.keys())


def _schema_fields(schema) -> dict[str, Any]:
    return getattr(schema, "model_fields", None) or getattr(schema, "__fields__", None) or {}


def _schema_json_instruction(schema) -> str:
    fields = _schema_field_names(schema)
    field_hint = ", ".join(f'"{field}"' for field in fields) if fields else "the requested schema fields"
    return (
        f"Return JSON for schema {schema.__name__} with exactly these fields when applicable: "
        f"{field_hint}. Include every required field. If a field named \"metadata\" exists, "
        "include it as 0 unless the prompt gives a specific metadata integer. Escape all "
        "newlines as \\n. Do not escape apostrophes with backslashes. Escape double quotes "
        "inside string values. Do not append notes."
    )


def _repair_schema_payload(cleaned: str, schema):
    """
    Handles local/Groq LLM schema misses:
    - DeepTeam schemas often require metadata, while models omit it.
    - Dialogue rewrite schemas may return one multiline string with unescaped quotes/newlines.
    """
    data = _loads_loose_json(cleaned, schema)

    if isinstance(data, dict):
        return _validate_with_field_repairs(data, schema)

    return schema.model_validate(data)


def _loads_loose_json(cleaned: str, schema):
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    normalized = _normalize_common_json_mistakes(cleaned)
    try:
        return json.loads(normalized)
    except json.JSONDecodeError:
        fields = _schema_field_names(schema)
        if len(fields) == 1:
            return _repair_single_string_field(normalized, fields[0])
        if fields:
            return _repair_object_string_fields(normalized, fields)
        raise


def _normalize_common_json_mistakes(text: str) -> str:
    normalized = text.strip()
    normalized = normalized.replace("\\'", "'")
    normalized = re.sub(r',\s*"metadata\s*:\s*null\s*}', ', "metadata": null}', normalized)
    normalized = re.sub(r',\s*"metadata\s*:\s*0\s*}', ', "metadata": 0}', normalized)
    return normalized


def _validate_with_field_repairs(data: dict[str, Any], schema):
    fields = _schema_fields(schema)
    repaired = dict(data)

    for _ in range(3):
        try:
            return schema.model_validate(repaired)
        except Exception as exc:
            errors = getattr(exc, "errors", lambda: [])()
            if not errors:
                raise

            changed = False
            for error in errors:
                loc = error.get("loc") or ()
                if not loc:
                    continue
                field_name = loc[0]
                if not isinstance(field_name, str) or field_name not in fields:
                    continue

                error_type = error.get("type", "")
                current = repaired.get(field_name)
                if error_type == "missing" or current is None:
                    repaired[field_name] = _default_for_field(field_name, fields[field_name], repaired)
                    changed = True
                elif "int" in error_type:
                    repaired[field_name] = _coerce_int(current)
                    changed = True
                elif "string" in error_type or "str" in error_type:
                    repaired[field_name] = "" if current is None else str(current)
                    changed = True

            if not changed:
                raise

    return schema.model_validate(repaired)


def _default_for_field(field_name: str, field: Any, data: dict[str, Any]):
    annotation = getattr(field, "annotation", None)
    if annotation is int or field_name == "metadata":
        return 0
    if annotation is bool:
        return False
    if annotation is float:
        return 0.0
    if annotation in (list, tuple, set):
        return []
    if annotation is dict:
        return {}
    if field_name == "rationale_behind_jailbreak":
        generated = data.get("generated_question") or data.get("input") or data.get("prompt") or ""
        return f"Generated for attack prompt: {generated}"[:500]
    return ""


def _coerce_int(value: Any) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        match = re.search(r"-?\d+", value)
        if match:
            return int(match.group(0))
    return 0


def _repair_single_string_field(cleaned: str, field_name: str) -> dict:
    prefix = f'"{field_name}"'
    key_index = cleaned.find(prefix)
    if key_index == -1:
        raise json.JSONDecodeError(f"Missing expected field {field_name}", cleaned, 0)

    colon_index = cleaned.find(":", key_index + len(prefix))
    first_quote = cleaned.find('"', colon_index + 1)
    last_quote = cleaned.rfind('"')
    if colon_index == -1 or first_quote == -1 or last_quote <= first_quote:
        raise json.JSONDecodeError(f"Could not repair field {field_name}", cleaned, 0)

    return {field_name: cleaned[first_quote + 1:last_quote]}


def _repair_object_string_fields(cleaned: str, field_names: list[str]) -> dict[str, str]:
    repaired: dict[str, str] = {}
    key_positions: list[tuple[str, int]] = []

    for field_name in field_names:
        key_index = cleaned.find(f'"{field_name}"')
        if key_index != -1:
            key_positions.append((field_name, key_index))

    key_positions.sort(key=lambda item: item[1])
    if not key_positions:
        raise json.JSONDecodeError("No schema fields found", cleaned, 0)

    for index, (field_name, key_index) in enumerate(key_positions):
        colon_index = cleaned.find(":", key_index + len(field_name) + 2)
        if colon_index == -1:
            continue

        value_start = cleaned.find('"', colon_index + 1)
        if value_start == -1:
            continue

        if index + 1 < len(key_positions):
            next_key_index = key_positions[index + 1][1]
            value_end = cleaned.rfind('",', value_start, next_key_index)
            if value_end == -1:
                value_end = cleaned.rfind('"', value_start, next_key_index)
        else:
            closing_brace = cleaned.rfind("}")
            value_end = cleaned.rfind('"', value_start, closing_brace if closing_brace != -1 else len(cleaned))

        if value_end <= value_start:
            continue

        repaired[field_name] = _decode_llm_string_value(cleaned[value_start + 1:value_end])

    if not repaired:
        raise json.JSONDecodeError("Could not repair schema object", cleaned, 0)

    return repaired


def _decode_llm_string_value(value: str) -> str:
    return (
        value.replace("\\n", "\n")
        .replace("\\t", "\t")
        .replace('\\"', '"')
        .replace("\\'", "'")
    )


# ── Ollama Simulator (local LLM for generating adversarial prompts) ──────────

class OllamaSimulator(DeepEvalBaseLLM):
    """
    Wraps local Ollama as a DeepEvalBaseLLM for use as DeepTeam's simulator_model.
    Runs on the user's local GPU — no rate limits, no API costs.
    """

    def __init__(
        self,
        model_name: Optional[str] = None,
        base_url: Optional[str] = None,
        temperature: float = 0.0,
    ):
        self.model_name = model_name or settings.OLLAMA_MODEL
        self.base_url = base_url or settings.OLLAMA_BASE_URL
        self.temperature = temperature
        self.client = OpenAI(
            api_key="ollama",
            base_url=self.base_url,
            timeout=120.0,
        )
        super().__init__(model_name=self.model_name)

    def load_model(self):
        return self

    def get_model_name(self) -> str:
        return f"ollama/{self.model_name}"

    def generate(self, prompt: str, schema=None) -> str:
        if schema is not None:
            prompt = (
                f"{prompt}\n\n"
                "IMPORTANT: Respond with ONLY one strict JSON object. "
                "No markdown code fences, no commentary, no explanation before or after. "
                f"{_schema_json_instruction(schema)}"
            )

        response = self.client.chat.completions.create(
            model=self.model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=self.temperature,
        )
        content = response.choices[0].message.content or ""

        if schema is not None:
            cleaned = _extract_json(content)
            try:
                return schema.model_validate_json(cleaned)
            except Exception as first_exc:
                try:
                    return _repair_schema_payload(cleaned, schema)
                except Exception as repair_exc:
                    raise ValueError(
                        f"Ollama did not return valid JSON for schema {schema.__name__}.\n"
                        f"Raw output: {content!r}\nCleaned: {cleaned!r}\n"
                        f"Original error: {first_exc}\nRepair error: {repair_exc}"
                    ) from first_exc
        return content

    async def a_generate(self, prompt: str, schema=None) -> str:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.generate, prompt, schema)


# ── Groq Evaluator (cloud LLM for judging vulnerability responses) ───────────

import threading
import time as _time

class GroqEvaluator(DeepEvalBaseLLM):
    """
    Wraps Groq's OpenAI-compatible API as a DeepEvalBaseLLM for use as
    DeepTeam's evaluation_model.

    Features:
    - Multi-key pool: rotates through GROQ_API_KEYS_POOL on rate limits
    - Retry with exponential backoff on 429/rate-limit errors
    - Verbose terminal logging for every rate limit event
    """

    def __init__(
        self,
        model_name: Optional[str] = None,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        temperature: float = 0.0,
    ):
        self.model_name = model_name or settings.GROQ_MODEL
        self.base_url = base_url or settings.GROQ_ENDPOINT
        self.temperature = temperature

        # Build API key pool: GROQ_API_KEYS_POOL (comma-separated) > single GROQ_API_KEY
        pool_str = settings.GROQ_API_KEYS_POOL or ""
        pool_keys = [k.strip() for k in pool_str.split(",") if k.strip()]
        single_key = api_key or settings.GROQ_API_KEY
        if not pool_keys and single_key:
            pool_keys = [single_key]

        if not pool_keys:
            raise ValueError("No Groq API keys configured. Set GROQ_API_KEY or GROQ_API_KEYS_POOL in .env")

        self._api_keys = pool_keys
        self._key_index = 0
        self._key_lock = threading.Lock()

        print(f"[GroqEvaluator] Initialized with {len(self._api_keys)} API key(s) for rotation")

        # Create initial client with first key
        self._clients: dict[str, OpenAI] = {}
        for key in self._api_keys:
            self._clients[key] = OpenAI(api_key=key, base_url=self.base_url)

        super().__init__(model_name=self.model_name)

    def _current_key(self) -> str:
        with self._key_lock:
            return self._api_keys[self._key_index % len(self._api_keys)]

    def _rotate_key(self, failed_key: str) -> str:
        with self._key_lock:
            old_idx = self._key_index
            self._key_index = (self._key_index + 1) % len(self._api_keys)
            new_key = self._api_keys[self._key_index]
            key_suffix_old = failed_key[-6:]
            key_suffix_new = new_key[-6:]
            print(
                f"[GroqEvaluator] 🔄 Rotating API key: "
                f"...{key_suffix_old} (key #{old_idx + 1}) → "
                f"...{key_suffix_new} (key #{self._key_index + 1}/{len(self._api_keys)})"
            )
            return new_key

    def load_model(self):
        return self._clients[self._current_key()]

    def get_model_name(self) -> str:
        return f"groq/{self.model_name}"

    def _is_rate_limit_error(self, exc: Exception) -> bool:
        """Check if exception is a rate limit (429) or resource exhausted error."""
        exc_str = str(exc).lower()
        if "429" in exc_str or "rate_limit" in exc_str or "rate limit" in exc_str:
            return True
        if "resource_exhausted" in exc_str or "resource exhausted" in exc_str:
            return True
        if "too many requests" in exc_str:
            return True
        if hasattr(exc, "status_code") and getattr(exc, "status_code", 0) == 429:
            return True
        return False

    def generate(self, prompt: str, schema=None) -> str:
        if schema is not None:
            prompt = (
                f"{prompt}\n\n"
                "IMPORTANT: Respond with ONLY one strict JSON object. "
                "No markdown code fences, no commentary, no explanation before or after. "
                f"{_schema_json_instruction(schema)}"
            )

        kwargs_base = {
            "model": self.model_name,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": self.temperature,
        }
        if schema is not None:
            kwargs_base["response_format"] = {"type": "json_object"}

        max_attempts = len(self._api_keys) * 2  # Try each key up to 2 times
        last_exc = None

        for attempt in range(max_attempts):
            current_key = self._current_key()
            client = self._clients[current_key]

            try:
                response = client.chat.completions.create(**kwargs_base)
                content = response.choices[0].message.content or ""

                if schema is not None:
                    cleaned = _extract_json(content)
                    try:
                        return schema.model_validate_json(cleaned)
                    except Exception as first_exc:
                        try:
                            return _repair_schema_payload(cleaned, schema)
                        except Exception as repair_exc:
                            raise ValueError(
                                f"Groq did not return valid JSON for schema {schema.__name__}.\n"
                                f"Raw output: {content!r}\nCleaned: {cleaned!r}\n"
                                f"Original error: {first_exc}\nRepair error: {repair_exc}"
                            ) from first_exc
                return content

            except Exception as exc:
                last_exc = exc
                if self._is_rate_limit_error(exc):
                    key_suffix = current_key[-6:]
                    wait = min(2 ** attempt, 10)  # 1s, 2s, 4s, 8s, 10s cap
                    print(
                        f"[GroqEvaluator] ⚠️  RATE LIMIT HIT on key ...{key_suffix} "
                        f"(attempt {attempt + 1}/{max_attempts}). "
                        f"Error: {str(exc)[:120]}"
                    )
                    # Rotate to next key
                    self._rotate_key(current_key)
                    print(f"[GroqEvaluator] ⏳ Waiting {wait}s before retry...")
                    _time.sleep(wait)
                    continue
                else:
                    # Non-rate-limit error — log and raise immediately
                    print(f"[GroqEvaluator] ❌ Non-rate-limit error: {str(exc)[:200]}")
                    raise

        # All attempts exhausted
        print(
            f"[GroqEvaluator] ❌ ALL {max_attempts} ATTEMPTS EXHAUSTED across {len(self._api_keys)} API keys. "
            f"Last error: {str(last_exc)[:200]}"
        )
        raise last_exc

    async def a_generate(self, prompt: str, schema=None) -> str:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self.generate, prompt, schema)

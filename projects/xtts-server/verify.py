#!/usr/bin/env python3
"""
Verification script for XTTS-v2 TTS Server.

Usage:
    uv run python verify.py

Requires the server to be running:
    uv run uvicorn main:app --host 0.0.0.0 --port 8000
"""

import base64
import json
import math
import struct
import sys
import wave
from pathlib import Path
from typing import Optional, Tuple

try:
    import requests
except ImportError:
    print("Installing requests...")
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "requests"])
    import requests


SERVER_URL = "http://localhost:8000"


def save_pcm_float32_to_wav(audio_bytes: bytes, sample_rate: int, output_path: Path) -> float:
    """Save float32 PCM bytes to a mono 16-bit WAV file. Returns duration."""
    audio_samples = struct.unpack(f"{len(audio_bytes)//4}f", audio_bytes)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output_path), "w") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)  # 16-bit
        wav.setframerate(sample_rate)
        int_samples = [int(max(-1, min(1, s)) * 32767) for s in audio_samples]
        wav.writeframes(struct.pack(f"{len(int_samples)}h", *int_samples))

    return len(audio_samples) / sample_rate


def generate_sine_wave(duration_seconds: float = 4.0, sample_rate: int = 16000, frequency: float = 220.0) -> Tuple[bytes, int]:
    """Generate synthetic mono float32 PCM audio for embedding tests."""
    sample_count = int(sample_rate * duration_seconds)
    samples = []
    for i in range(sample_count):
        t = i / sample_rate
        sample = 0.5 * math.sin(2 * math.pi * frequency * t)
        samples.append(sample)
    audio_bytes = struct.pack(f"{len(samples)}f", *samples)
    return audio_bytes, sample_rate


def test_health():
    """Test the health endpoint."""
    print("\n1. Testing /health endpoint...")
    try:
        response = requests.get(f"{SERVER_URL}/health", timeout=10)
        response.raise_for_status()
        data = response.json()
        print(f"   Status: {data.get('status')}")
        print(f"   Model loaded: {data.get('model_loaded')}")
        print(f"   Supported languages: {data.get('supported_languages')}")
        return True
    except requests.exceptions.ConnectionError:
        print("   ERROR: Cannot connect to server. Is it running?")
        print(f"   Start with: uv run uvicorn main:app --host 0.0.0.0 --port 8000")
        return False
    except Exception as e:
        print(f"   ERROR: {e}")
        return False


def test_synthesize(embedding_b64: Optional[str]) -> bool:
    """Test the synthesize endpoint using a shared embedding across languages."""
    print("\n2. Testing /synthesize endpoint with captured embedding...")

    test_cases = [
        ("es", "Hola mundo, esta es una prueba."),
        ("zh", "你好世界"),
        ("ko", "안녕하세요"),
    ]

    output_dir = Path("test_output")
    output_dir.mkdir(exist_ok=True)

    for lang, text in test_cases:
        print(f"   Synthesizing [{lang}]: '{text}'...")
        try:
            payload: dict = {"text": text, "language": lang, "speed": 1.0}
            if embedding_b64:
                payload["embedding_base64"] = embedding_b64

            response = requests.post(
                f"{SERVER_URL}/synthesize",
                json=payload,
                timeout=60,
            )
            response.raise_for_status()
            data = response.json()

            # Decode audio
            audio_b64 = data.get("audio_base64", "")
            sample_rate = data.get("sample_rate", 22050)
            duration = data.get("duration_seconds", 0)
            latency_warning = data.get("latency_warning")

            audio_bytes = base64.b64decode(audio_b64)
            output_path = output_dir / f"test_{lang}_with_embedding.wav"
            save_pcm_float32_to_wav(audio_bytes, sample_rate, output_path)

            if latency_warning:
                print(f"      WARNING: {latency_warning}")
            print(f"      Duration: {duration:.2f}s, saved to: {output_path}")

        except requests.exceptions.Timeout:
            print(f"      TIMEOUT: Synthesis took too long (>60s)")
            return False
        except Exception as e:
            print(f"      ERROR: {e}")
            return False

    print(f"\n   Audio files saved to: {output_dir.absolute()}")
    return True


def test_extract_embedding() -> Tuple[Optional[str], bool]:
    """Test the extract-embedding endpoint with synthetic audio and return embedding."""
    print("\n3. Testing /extract-embedding endpoint...")

    # Generate 4 seconds of synthetic audio (sine wave)
    audio_bytes, sample_rate = generate_sine_wave(duration_seconds=4.0, sample_rate=16000, frequency=220.0)
    audio_b64 = base64.b64encode(audio_bytes).decode("utf-8")

    try:
        response = requests.post(
            f"{SERVER_URL}/extract-embedding",
            json={"audio_base64": audio_b64, "sample_rate": sample_rate},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()

        embedding_b64 = data.get("embedding_base64", "")
        shape = data.get("embedding_shape", [])

        print(f"   Embedding shape: {shape or 'unknown'}")
        print(f"   Embedding size: {len(base64.b64decode(embedding_b64))} bytes")
        print(f"   Input duration: {data.get('duration_seconds', 0):.2f}s")
        print(f"   Processing time: {data.get('processing_time_seconds', 0):.2f}s")
        return embedding_b64, True

    except Exception as e:
        print(f"   ERROR: {e}")
        return None, False


def main():
    print("=" * 50)
    print("XTTS-v2 TTS Server Verification")
    print("=" * 50)

    # Test health first
    if not test_health():
        print("\n" + "=" * 50)
        print("FAILED: Server not running or not healthy")
        print("=" * 50)
        sys.exit(1)

    # Extract embedding first (returns base64 string)
    embedding_b64, embed_ok = test_extract_embedding()
    if not embed_ok or not embedding_b64:
        print("\n" + "=" * 50)
        print("FAILED: Could not extract embedding")
        print("=" * 50)
        sys.exit(1)

    # Test synthesis
    synth_ok = test_synthesize(embedding_b64)

    print("\n" + "=" * 50)
    if synth_ok and embed_ok:
        print("SUCCESS: All tests passed!")
    else:
        print("PARTIAL: Some tests failed")
    print("=" * 50)


if __name__ == "__main__":
    main()

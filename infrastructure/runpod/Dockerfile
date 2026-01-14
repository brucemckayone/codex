# RunPod Transcoding Worker
# GPU-accelerated media transcoding with FFmpeg and audiowaveform
#
# Features:
# - NVIDIA GPU support (h264_nvenc)
# - CPU fallback (libx264)
# - HLS multi-quality transcoding
# - Audio waveform generation
# - S3-compatible storage (R2/B2)

FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04

# Prevent interactive prompts during install
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    software-properties-common \
    && add-apt-repository ppa:chris-needham/ppa \
    && apt-get update && apt-get install -y --no-install-recommends \
    # FFmpeg with all codecs
    ffmpeg \
    # Python runtime
    python3 \
    python3-pip \
    python3-dev \
    # audiowaveform for audio visualization
    audiowaveform \
    # Utilities
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create working directory
WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy handler code
COPY handler/ ./handler/

# Set Python path
ENV PYTHONPATH=/app

# RunPod serverless entry point
CMD ["python3", "-u", "handler/main.py"]

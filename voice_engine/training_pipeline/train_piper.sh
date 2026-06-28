#!/bin/bash
# train_piper.sh - Chronos VITS Piper TTS Fine-Tuning Script
# Optimized for NVIDIA RTX 5060 Laptop GPU (8GB VRAM)

set -e

# Setup dataset path variables
PROCESSED_DATA_DIR="./datasets/processed_corpus"
CHECKPOINT_OUTPUT_DIR="../checkpoints"
BATCH_SIZE=16
PRECISION=16  # Enable FP16 mixed precision to fit within 8GB VRAM

echo "🚀 Starting Chronos voice model fine-tuning..."
echo "📍 Data Directory: $PROCESSED_DATA_DIR"
echo "📍 Output Directory: $CHECKPOINT_OUTPUT_DIR"
echo "⚡ GPU Mixed Precision: FP$PRECISION enabled"

# Check if preprocessed data exists
if [ ! -d "$PROCESSED_DATA_DIR" ]; then
    echo "❌ Preprocessed dataset not found at $PROCESSED_DATA_DIR."
    echo "Please run piper_train.preprocess first to phonemize and format your human dataset."
    exit 1
fi

# Execute training command
python3 -m piper_train \
    --dataset-dir "$PROCESSED_DATA_DIR" \
    --output-dir "$CHECKPOINT_OUTPUT_DIR" \
    --batch-size $BATCH_SIZE \
    --precision $PRECISION \
    --validation-split 0.05 \
    --checkpoint-epochs 1 \
    --max-epochs 100

echo "✅ Fine-tuning session finished successfully."

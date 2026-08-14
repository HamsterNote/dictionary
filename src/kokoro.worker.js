const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const workerScope = globalThis;

let ttsPromise;

async function loadTts() {
  const { KokoroTTS } = await import('kokoro-js');
  const gpu = workerScope.navigator?.gpu;

  if (gpu) {
    try {
      if (await gpu.requestAdapter()) {
        // WebGPU 对 Kokoro 的 fp32 模型优化最好；q8 在 GPU 上反而更慢且可能失真。
        return await KokoroTTS.from_pretrained(MODEL_ID, {
          device: 'webgpu',
          dtype: 'fp32',
        });
      }
    } catch {
      // WebGPU 可能因驱动、显存或实验性实现初始化失败，继续使用兼容性更好的 WASM。
    }
  }

  return KokoroTTS.from_pretrained(MODEL_ID, {
    device: 'wasm',
    dtype: 'q8',
  });
}

function getTts() {
  ttsPromise ??= loadTts().catch((error) => {
    ttsPromise = undefined;
    throw error;
  });
  return ttsPromise;
}

workerScope.addEventListener('message', (event) => {
  const { id, text } = event.data;
  void getTts()
    .then((tts) => tts.generate(text, { speed: 1, voice: 'af_heart' }))
    .then(
      (audio) => {
        workerScope.postMessage({ audio: audio.toBlob(), id, status: 'success' });
      },
      (error) => {
        workerScope.postMessage({
          id,
          message: error instanceof Error ? error.message : 'Kokoro 语音生成失败',
          status: 'error',
        });
      },
    );
});
